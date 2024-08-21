import {StepMap} from "prosemirror-transform"

function addRange(ranges: number[], pos: number, del: number, ins: number) {
  let l = ranges.length
  if (l && ranges[l - 3] + ranges[l - 2] == pos) {
    ranges[l - 2] += del
    ranges[l - 1] += ins
  } else {
    ranges.push(pos, del, ins)
  }
}

export function createMapping(changes: readonly {from: number, to: number, insert: number}[]) {
  let ranges: number[] = []
  for (let change of changes) addRange(ranges, change.from, change.to - change.from, change.insert)
  return new StepMap(ranges)
}

export function transformMapping(map: StepMap, over: StepMap) {
  let ranges: number[] = [], oldRanges: number[] = (map as any).ranges
  for (let i = 0; i < oldRanges.length;) {
    let from = oldRanges[i++], del = oldRanges[i++], ins = oldRanges[i++]
    let newFrom = over.map(from, 1), newTo = Math.max(newFrom, over.map(from + del, -1))
    addRange(ranges, newFrom, newTo - newFrom, ins)
  }
  return new StepMap(ranges)
}

class MapIter {
  ranges: number[]
  i = 0
  pos = 0
  len: number
  ins = -1
  off = false

  constructor(map: StepMap) {
    let ranges = this.ranges = (map as any).ranges
    if (!ranges.length) {
      this.len = 1e9
    } else if (ranges[0] == 0) {
      this.len = ranges[1]
      this.ins = ranges[2]
      this.i = 3
    } else {
      this.len = ranges[0]
    }
  }

  adv(len: number) {
    this.pos += len
    if (len < this.len) {
      this.len -= len
      this.off = true
    } else if (this.i == this.ranges.length) {
      this.len = 1e9
      this.ins = -1
    } else if (this.pos == this.ranges[this.i]) {
      this.len = this.ranges[this.i + 1]
      this.ins = this.ranges[this.i + 2]
      this.off = false
      this.i += 3
    } else {
      this.len = this.ranges[this.i] - this.pos
      this.ins = -1
    }
  }

  adv2(len: number) {
    if (this.ins == -1) this.adv(len)
    else if (len == this.ins) this.adv(this.len)
    else { this.ins -= len; this.off = true }
  }
}

export function composeMapping(a: StepMap, b: StepMap) {
  let iA = new MapIter(a), iB = new MapIter(b)
  let ranges: number[] = []
  for (;;) {
    if (iA.i == iA.ranges.length && iA.ins < 0 && iB.i == iB.ranges.length && iB.ins < 0) {
      return new StepMap(ranges)
    } else if (iA.ins == 0) {
      addRange(ranges, iA.pos, iA.len, 0)
      iA.adv(iA.len)
    } else if (iB.len == 0) {
      addRange(ranges, iA.pos, 0, iB.ins)
      iB.adv(0)
    } else {
      let len = Math.min(iA.ins < 0 ? iA.len : iA.ins, iB.len)
      if (iA.ins == -1) {
        if (iB.ins > -1) addRange(ranges, iA.pos, len, iB.off ? 0 : iB.ins)
      } else if (iB.ins == -1) {
        addRange(ranges, iA.pos, iA.off ? 0 : iA.len, len)
      } else {
        addRange(ranges, iA.pos, iA.off ? 0 : iA.len, iB.off ? 0 : iB.ins)
      }
      iA.adv2(len)
      iB.adv(len)
    }
  }  
}
