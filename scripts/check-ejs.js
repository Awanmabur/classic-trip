'use strict';

const fs = require('fs');
const path = require('path');

let ejs = null;
try {
  // Use the real compiler whenever dependencies are installed.
  // The fallback below exists so release artifacts can still be checked in
  // restricted build environments where the package registry is unavailable.
  ejs = require('ejs');
} catch (_) {
  ejs = null;
}

const root = path.resolve(__dirname, '..');
const views = path.join(root, 'src', 'views');
const failures = [];
let count = 0;

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function quoteLiteral(value) {
  return JSON.stringify(value);
}

function compileWithoutDependency(template, filename) {
  let cursor = 0;
  let generated = 'return function template(locals){\n';
  generated += 'locals = locals || {};\n';
  generated += 'with (locals) {\n';
  generated += 'let __output = "";\n';

  const opener = /<%([_\-=#]?)/g;
  let match;
  while ((match = opener.exec(template)) !== null) {
    const text = template.slice(cursor, match.index);
    if (text) generated += `__output += ${quoteLiteral(text)};\n`;

    const marker = match[1];
    const closeIndex = template.indexOf('%>', opener.lastIndex);
    if (closeIndex === -1) throw new SyntaxError('Unclosed EJS tag');

    let body = template.slice(opener.lastIndex, closeIndex);
    if (body.endsWith('-')) body = body.slice(0, -1);

    if (marker === '=' || marker === '-') {
      generated += `__output += String(((${body}) ?? ""));\n`;
    } else if (marker === '#') {
      generated += '\n';
    } else {
      generated += `${body}\n`;
    }

    cursor = closeIndex + 2;
    opener.lastIndex = cursor;
  }

  const tail = template.slice(cursor);
  if (tail) generated += `__output += ${quoteLiteral(tail)};\n`;
  generated += 'return __output;\n}\n};\n';

  try {
    // Syntax compilation only; the template is never executed.
    // eslint-disable-next-line no-new-func
    new Function(generated);
  } catch (error) {
    error.message = `${filename}: ${error.message}`;
    throw error;
  }
}

for (const file of walk(views).filter((item) => item.endsWith('.ejs'))) {
  count += 1;
  try {
    const template = fs.readFileSync(file, 'utf8');
    if (ejs) {
      ejs.compile(template, { filename: file, client: true, strict: false });
    } else {
      compileWithoutDependency(template, file);
    }
  } catch (error) {
    failures.push(`${path.relative(root, file)}: ${error.message}`);
  }
}

if (failures.length) {
  console.error(`EJS validation failed (${failures.length}/${count}):\n${failures.join('\n')}`);
  process.exit(1);
}

const mode = ejs ? 'EJS compiler' : 'dependency-free syntax compiler';
console.log(`EJS validation passed (${count}/${count}, ${mode}).`);
