import {schema as oldSchema} from "prosemirror-schema-basic"
import {Node, NodeType, Fragment, Mark, Schema, Slice, ContentMatch} from "prosemirror-model"
import {Step, StepMap, ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep,
        AddNodeMarkStep, RemoveNodeMarkStep, AttrStep, DocAttrStep} from "prosemirror-transform"

const newSchema = new Schema({
  nodes: oldSchema.spec.nodes.remove("horizontal_rule").remove("image").append({
    picture: oldSchema.spec.nodes.get("image")!
  }),
  marks: oldSchema.spec.marks
})

export {oldSchema, newSchema}

type Change = {from: number, to: number, insert: number}

function translateMark(mark: Mark) {
  return newSchema.marks[mark.type.name].create(mark.attrs)
}

// FIXME handle replace-around injected content
function translateFragment(fragment: Fragment, parentType: NodeType,
                           openStart: readonly ContentMatch[], openEnd: readonly Fragment[],
                           changes: Change[], pos: number): Fragment {
  let children = [], match = openStart.length ? openStart[0] : parentType.contentMatch
  for (let i = 0; i < fragment.childCount; i++) {
    let child = fragment.child(i)
    if (child.type.name == "horizontal_rule") {
      changes.push({from: pos, to: pos + child.nodeSize, insert: 0})
    } else {
      let type = newSchema.nodes[child.type.name == "image" ? "picture" : child.type.name]
      let content = translateFragment(child.content, type, i ? [] : openStart.slice(1),
                                      i < fragment.childCount - 1 ? [] : openEnd.slice(1),
                                      changes, pos + 1)
      let marks = child.marks.map(translateMark)
      let newChild = type.isText ? type.schema.text(child.text!, marks) : type.create(child.attrs, content, marks)
      let fit = match.matchType(type)
      if (!fit) {
        let fill = match.fillBefore(Fragment.from(newChild), false)
        if (!fill) throw new Error(`Cannot place node of type ${type.name} in ${parentType.name}`)
        for (let j = 0; j < fill.childCount; j++) {
          children.push(fill.child(j))
          match = match.matchType(fill.child(j).type)!
          pos += fill.size
          changes.push({from: pos, to: pos, insert: fill.size})
        }
        match = match.matchType(type)!
      } else {
        match = fit
      }
      children.push(newChild)
    }
    pos += child.nodeSize
  }
  let after = openEnd.length ? openEnd[0] : Fragment.empty, fill = match.fillBefore(after, true)
  if (!fill) throw new Error(`Cannot finish node ${parentType.name} before content ${after}`)
  if (fill.childCount) {
    for (let j = 0; j < fill.childCount; j++) children.push(fill.child(j))
    changes.push({from: pos, to: pos, insert: fill.size})
  }
  return Fragment.from(children)
}

export function translateSlice(slice: Slice, doc: Node, from: number, to: number, changes: Change[]): Slice {
  let $from = doc.resolve(from), $to = doc.resolve(to)
  let openStart: ContentMatch[] = [], openEnd: Fragment[] = []
  for (let i = 0; i < slice.openStart; i++) {
    let node = $from.node(-i), index = $from.indexAfter(-i)
    openStart.push(node.contentMatchAt(index))
  }
  for (let i = 0; i < slice.openEnd; i++) {
    let node = $to.node(-i), index = $to.index(-i)
    openEnd.push(node.content.cut($to.posAtIndex(index, -i)))
  }
  return new Slice(translateFragment(slice.content, $from.node().type, openStart, openEnd, changes, $from.pos),
                   slice.openStart, slice.openEnd)
}

export function translateDoc(doc: Node, changes?: Change[]) {
  return newSchema.nodes.doc.create(null, translateFragment(doc.content, newSchema.nodes.doc, [], [], changes || [], 0))
}

function addRange(ranges: number[], pos: number, del: number, ins: number) {
  let l = ranges.length
  if (l && ranges[l - 3] + ranges[l - 2] == pos) {
    ranges[l - 2] += del
    ranges[l - 1] += ins
  } else {
    ranges.push(pos, del, ins)
  }
}

function createMap(changes: readonly Change[]) {
  let ranges: number[] = []
  for (let change of changes) addRange(ranges, change.from, change.to - change.from, change.insert)
  return new StepMap(ranges)
}

function transformMapping(map: StepMap, over: StepMap) {
  let ranges: number[] = [], oldRanges: number[] = (map as any).ranges
  for (let i = 0; i < oldRanges.length;) {
    let from = oldRanges[i++], del = oldRanges[i++], ins = oldRanges[i++]
    let newFrom = over.map(from, 1), newTo = Math.max(newFrom, over.map(from + del, -1))
    addRange(ranges, newFrom, newTo - newFrom, ins)
  }
  return new StepMap(ranges)
}

function composeMapping(a: StepMap, b: StepMap) {
  let rA: number[] = (a as any).ranges, iA = 0
  let posA = -1, delA = -1, insA = -1
  function nextA() { posA = rA[iA++]; delA = rA[iA++]; insA = rA[iA++] }
  if (rA.length) nextA()
  let rB: number[] = (b as any).ranges, iB = 0
  let posB = -1, delB = -1, insB = -1
  function nextB() { posB = rB[iB++]; delB = rB[iB++]; insB = rB[iB++] }
  if (rB.length) nextB()

  let ranges: number[] = []
  for (let posBefore = 0, posMid = 0;;) {
    if (posA < 0 && posB < 0) {
      return new StepMap(ranges)
    } else if (posA == posBefore) {
      let len = delA
      if (posB > -1) len = Math.min(len, posB - posMid)
      posBefore += len
      posMid += insA
      addRange(ranges, posA, len, insA)
      if (delA == len) {
        nextA()
      } else {
        delA -= len; posA += len; insA = 0
      }
    } else if (posB == posMid) {
      let len = delB
      if (posA > -1) len = Math.min(len, posA - posBefore)
      posMid += len
      addRange(ranges, posBefore, len, insB)
      if (delB == len) {
        nextB()
      } else {
        delB -= len; posB += len; insB = 0
      }
    } else {
      // Skip unchanged content
      let dist = Math.min(posA < 0 ? 1e9 : posA - posBefore, posB < 0 ? 1e9 : posB - posMid)
      posBefore += dist; posMid += dist
    }
  }  
}

export function translateSteps(startDoc: Node, steps: readonly Step[]) {
  let docChanges: Change[] = []
  let before = translateDoc(startDoc, docChanges)
  let doc = before, newSteps: Step[] = []
  let map = createMap(docChanges)
  for (let s of steps) {
    let step = s.map(map), newStep, changes: Change[] = []
    if (!step) continue
    if (step instanceof AddMarkStep) {
      newStep = new AddMarkStep(step.from, step.to, translateMark(step.mark))
    } else if (step instanceof RemoveMarkStep) {
      newStep = new RemoveMarkStep(step.from, step.to, translateMark(step.mark))
    } else if (step instanceof AddNodeMarkStep) {
      newStep = new AddNodeMarkStep(step.pos, translateMark(step.mark))
    } else if (step instanceof RemoveNodeMarkStep) {
      newStep = new RemoveNodeMarkStep(step.pos, translateMark(step.mark))
    } else if (step instanceof ReplaceStep) {
      newStep = new ReplaceStep(step.from, step.to, translateSlice(step.slice, doc, step.from, step.to, changes))
    } else if (step instanceof ReplaceAroundStep) {
      throw new Error("FIXME")
    } else if (step instanceof AttrStep) {
      newStep = new AttrStep(step.pos, step.attr, step.value)
    } else if (step instanceof DocAttrStep) {
      newStep = step
    } else {
      throw new Error(`Unsupported step type: ${(step as any).jsonID}.`)
    }
    if (changes.length) map = composeMapping(map, createMap(changes))
    let stepMap = newStep.getMap()
    if (stepMap != StepMap.empty) map = transformMapping(map, stepMap)
    newSteps.push(newStep)
    let result = newStep.apply(doc)
    if (result.failed) throw new Error(`Failed to apply translated step: ${result.failed}`)
    doc = result.doc!
  }
  return {startDoc: before, doc, steps: newSteps, map}
}
