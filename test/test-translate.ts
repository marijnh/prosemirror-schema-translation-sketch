import {newSchema, oldSchema, translateDoc} from "../src/translate.js"
import {builders} from "prosemirror-test-builder"

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
