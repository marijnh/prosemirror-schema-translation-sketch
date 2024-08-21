import {newSchema, oldSchema, translateDoc, translateSteps} from "../src/translate.js"
import {builders} from "prosemirror-test-builder"
import {Transform, ReplaceAroundStep} from "prosemirror-transform"
import {Node, Slice, Fragment} from "prosemirror-model"

let o = builders(oldSchema, {p: {nodeType: "paragraph"}, hr: {nodeType: "horizontal_rule"}})
let n = builders(newSchema, {p: {nodeType: "paragraph"}})

function eq<T extends {eq(other: T): boolean}>(a: T, b: T) {
  if (!a.eq(b)) throw new Error(`!eq(${a}, ${b})`)
}

describe("translateDoc", () => {
  it("can translate a simple doc", () => {
    eq(translateDoc(o.doc(o.p("One ", o.strong("two")))),
       n.doc(n.p("One ", n.strong("two"))))
  })

  it("renames image nodes", () => {
    eq(translateDoc(o.doc(o.p(o.image({src: "x.png"})))),
       n.doc(n.p(n.picture({src: "x.png"}))))
  })

  it("removes horizontal rule nodes", () => {
    eq(translateDoc(o.doc(o.p("One"), o.hr())),
       n.doc(n.p("One")))
  })

  it("creates replacement nodes when needed", () => {
    eq(translateDoc(o.doc(o.hr())),
       n.doc(n.p()))
  })
})

describe("translateSteps", () => {
  function steps(tr: Transform, expect: Node) {
    let {doc} = translateSteps(tr.before, tr.steps)
    eq(doc, expect)
  }

  it("translates mark steps", () => {
    steps(
      new Transform(o.doc(o.p(o.strong("One two"))))
        .addMark(5, 8, oldSchema.mark("em"))
        .removeMark(1, 5, oldSchema.mark("strong")),
      n.doc(n.p("One ", n.strong(n.em("two")))))
  })

  it("scrubs horizontal rules", () => {
    steps(
      new Transform(o.doc(o.p("a")))
        .insert(3, o.hr()),
      n.doc(n.p("a")))
  })

  it("replaces horizontal rules that are only child", () => {
    steps(
      new Transform(o.doc(o.p("a")))
        .replaceWith(0, 3, o.hr()),
      n.doc(n.p()))
  })

  it("adjusts step positions for changes in the start doc", () => {
    steps(
      new Transform(o.doc(o.hr(), o.p("abc")))
        .addMark(3, 4, oldSchema.mark("strong")),
      n.doc(n.p("a", n.strong("b"), "c")))
  })

  it("adjusts step positions for adjustments in previous steps", () => {
    steps(
      new Transform(o.doc(o.p("abc")))
        .insert(0, o.hr())
        .addMark(3, 4, oldSchema.mark("strong")),
      n.doc(n.p("a", n.strong("b"), "c")))
  })

  it("combines adjustments for doc and steps", () => {
    steps(
      new Transform(o.doc(o.hr(), o.blockquote(o.p("x")), o.p("abc")))
        .replaceWith(2, 5, o.hr())
        .addMark(6, 7, oldSchema.mark("strong")),
      n.doc(n.blockquote(n.p()), n.p("a", n.strong("b"), "c")))
  })

  it("combines adjustments for multiple steps", () => {
    steps(
      new Transform(o.doc(o.p("x")))
        .insert(0, o.hr())
        .insert(4, o.hr())
        .insert(1, o.hr())
        .addMark(3, 4, oldSchema.mark("em")),
      n.doc(n.p(n.em("x"))))
  })

  it("can handle replace-around steps", () => {
    steps(
      new Transform(o.doc(o.p("abc")))
        .step(new ReplaceAroundStep(0, 5, 1, 4, new Slice(Fragment.from([o.hr(), o.heading({level: 1}), o.hr()]), 0, 0), 2)),
      n.doc(n.heading({level: 1}, "abc")))
  })
})
