import {Node, NodeType, Fragment, Mark, Schema, Slice, ContentMatch} from "prosemirror-model"
import {Step, StepMap, ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep,
        AddNodeMarkStep, RemoveNodeMarkStep, AttrStep, DocAttrStep} from "prosemirror-transform"
import {createMapping, composeMapping, transformMapping} from "./map.js"

export class SchemaTranslation {
  constructor(readonly oldSchema: Schema, readonly newSchema: Schema,
              readonly mapping: {[nodeName: string]: string | false}) {}

  translateMark(mark: Mark) {
    return this.newSchema.marks[mark.type.name].create(mark.attrs)
  }

  translateDoc(doc: Node) {
    return translateDoc(doc, this)
  }

  translateSteps(startDoc: Node, steps: readonly Step[]) {
    return translateSteps(startDoc, steps, this)
  }
}

type Change = {from: number, to: number, insert: number}

function translateFragment(fragment: Fragment, parentType: NodeType,
                           openStart: readonly ContentMatch[], openEnd: readonly Fragment[],
                           changes: Change[], pos: number, tr: SchemaTranslation,
                           inject: null | {at: number, content: Fragment}): Fragment {
  let children = [], match = openStart.length ? openStart[0] : parentType.contentMatch
  for (let i = 0;; i++) {
    if (inject && inject.at == pos) {
      pos += inject.content.size
      match = match.matchFragment(inject.content) || match
    }
    if (i == fragment.childCount) break
    let child = fragment.child(i)
    if (inject && child.isText && inject.at > pos && inject.at < pos + child.nodeSize) {
      pos += inject.content.size
      match = match.matchFragment(inject.content) || match
    }
    let mapped = tr.mapping[child.type.name]
    if (mapped == false) {
      changes.push({from: pos, to: pos + child.nodeSize, insert: 0})
    } else {
      let type = tr.newSchema.nodes[mapped || child.type.name]
      let content = translateFragment(child.content, type, i ? [] : openStart.slice(1),
                                      i < fragment.childCount - 1 ? [] : openEnd.slice(1),
                                      changes, pos + 1, tr, inject)
      let marks = child.marks.map(m => tr.translateMark(m))
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

export function translateSlice(slice: Slice, doc: Node, from: number, to: number, changes: Change[],
                               tr: SchemaTranslation, inject: null | {at: number, content: Fragment}): Slice {
  let $from = doc.resolve(from), $to = doc.resolve(to)
  let openStart: ContentMatch[] = [], openEnd: Fragment[] = []
  for (let i = slice.openStart; i >= 0; i--) {
    let d = $from.depth - i, node = $from.node(d), index = $from.indexAfter(d)
    openStart.push(node.contentMatchAt(index))
  }
  for (let i = slice.openEnd; i >= 0; i--) {
    let d = $to.depth - i, node = $to.node(d), index = $to.index(d)
    openEnd.push(node.content.cut($to.posAtIndex(index, d)))
  }
  return new Slice(translateFragment(slice.content, $from.node().type, openStart, openEnd, changes, $from.pos, tr, inject),
                   slice.openStart, slice.openEnd)
}

export function translateDoc(doc: Node, tr: SchemaTranslation, changes?: Change[]) {
  let content = translateFragment(doc.content, tr.newSchema.nodes.doc, [], [], changes || [], 0, tr, null)
  return tr.newSchema.nodes.doc.create(null, content)
}

export function translateSteps(startDoc: Node, steps: readonly Step[], tr: SchemaTranslation) {
  let docChanges: Change[] = []
  let before = translateDoc(startDoc, tr, docChanges)
  let doc = before, newSteps: Step[] = []
  let map = createMapping(docChanges)
  for (let s of steps) {
    let step = s.map(map), newStep, changes: Change[] = []
    if (!step) continue
    if (step instanceof AddMarkStep) {
      newStep = new AddMarkStep(step.from, step.to, tr.translateMark(step.mark))
    } else if (step instanceof RemoveMarkStep) {
      newStep = new RemoveMarkStep(step.from, step.to, tr.translateMark(step.mark))
    } else if (step instanceof AddNodeMarkStep) {
      newStep = new AddNodeMarkStep(step.pos, tr.translateMark(step.mark))
    } else if (step instanceof RemoveNodeMarkStep) {
      newStep = new RemoveNodeMarkStep(step.pos, tr.translateMark(step.mark))
    } else if (step instanceof ReplaceStep) {
      newStep = new ReplaceStep(step.from, step.to, translateSlice(step.slice, doc, step.from, step.to, changes, tr, null))
    } else if (step instanceof ReplaceAroundStep) {
      let injectPos = step.gapFrom + step.insert
      let inject = {at: injectPos, content: doc.slice(step.gapFrom, step.gapTo).content}
      let slice = translateSlice(step.slice, doc, step.from, step.to, changes, tr, inject)
      for (let ch of changes) if (ch.from < injectPos) injectPos += ch.insert - (ch.to - ch.from)
      newStep = new ReplaceAroundStep(step.from, step.to, step.gapFrom, step.gapTo, slice, injectPos - step.gapFrom)
    } else if (step instanceof AttrStep) {
      newStep = new AttrStep(step.pos, step.attr, step.value)
    } else if (step instanceof DocAttrStep) {
      newStep = step
    } else {
      throw new Error(`Unsupported step type: ${(step as any).jsonID}.`)
    }
    let stepMap = newStep.getMap()
    if (stepMap != StepMap.empty) map = transformMapping(map, stepMap)
    if (changes.length) map = composeMapping(map, createMapping(changes))
    newSteps.push(newStep)
    let result = newStep.apply(doc)
    if (result.failed) throw new Error(`Failed to apply translated step: ${result.failed}`)
    doc = result.doc!
  }
  return {startDoc: before, doc, steps: newSteps, map}
}
