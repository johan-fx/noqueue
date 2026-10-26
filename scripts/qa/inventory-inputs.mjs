// Static JSX call sites, not rendered field counts. Dynamic props/loops require runtime QA.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
const root = path.resolve(import.meta.dirname, '../..')
const controls = new Set(['input', 'textarea', 'select', 'Input', 'InputGroupInput', 'InputGroupTextarea', 'Textarea', 'TimeInput', 'NumberInput', 'PhoneInput', 'PasswordField', 'Select', 'Choice', 'ComboboxInput', 'ComboboxPrimitive.Input', 'Checkbox', 'Switch', 'ToggleGroup', 'RadioGroup'])
const rows = []
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) { scan(file); continue }
    if (!file.endsWith('.tsx') || /\.(test|spec)\./.test(file)) continue
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function visit(node) {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && controls.has(node.tagName.getText(source))) {
        const attrs = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(source), a.initializer ? ts.isStringLiteral(a.initializer) ? a.initializer.text : a.initializer.getText(source) : true]))
        rows.push({ file: path.relative(root, file), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, control: node.tagName.getText(source), ...attrs, hasSpread: node.attributes.properties.some(ts.isJsxSpreadAttribute) })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}
scan(path.join(root, 'apps/web/src'))
console.log(JSON.stringify({ scope: 'Static JSX call sites; includes component definitions, dynamic props and loops, excludes tests. Not a count of user-visible fields.', count: rows.length, countsByControl: rows.reduce((a, r) => ({ ...a, [r.control]: (a[r.control] ?? 0) + 1 }), {}), rows }, null, 2))
