'use strict';
/**
 * "Build" step for a plain Node/Express + static frontend app:
 *  1. validates every /config JSON file against its schema
 *  2. syntax-checks all server and browser JavaScript
 * There is no bundler: /public is served as-is.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.LOG_LEVEL = 'silent';
const root = path.join(__dirname, '..');

// 1. config validation (configStore throws on invalid files)
require('../server/services/configStore');
const users = JSON.parse(fs.readFileSync(path.join(root, 'config', 'demo-users.json'), 'utf8')).users;
if (!users.every((u) => u.email && u.role && /^\$2[aby]\$/.test(u.passwordHash))) throw new Error('config/demo-users.json: every user needs email, role and a bcrypt passwordHash');
console.log('config OK');

// 2. syntax check
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = ['server', 'public/js', 'scripts', 'tests'].flatMap((d) => (fs.existsSync(path.join(root, d)) ? walk(path.join(root, d)) : [])).filter((f) => f.endsWith('.js'));
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`syntax OK (${files.length} files)`);

// 3. strict-CSP guard: no inline scripts / styles in HTML
for (const dir of ['public', 'views']) {
  if (!fs.existsSync(path.join(root, dir))) continue;
  for (const f of walk(path.join(root, dir)).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(f, 'utf8');
    if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /\sstyle=|\son[a-z]+=/i.test(html) || /<style[\s>]/i.test(html)) throw new Error(`${path.relative(root, f)} contains inline script/style (blocked by CSP)`);
  }
}
console.log('CSP guard OK');
