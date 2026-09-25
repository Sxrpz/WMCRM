#!/usr/bin/env node
/**
 * 把 cordys-to-json.py 生成的 JSON 导入 WMCRM 数据库。
 *
 * 用法:
 *   node scripts/import-json.js data/cordys-customers.json
 *   node scripts/import-json.js data/cordys-customers.json --clear  # 先清空已有客户
 */
const crypto = require('crypto');
const path = require('path');
const db = require(path.join(__dirname, '..', 'db.js'));

const jsonPath = process.argv[2];
const allowClear = process.argv.includes('--clear');

if (!jsonPath) {
  console.error('用法: node scripts/import-json.js <json文件> [--clear]');
  process.exit(1);
}

function uid() {
  return crypto.randomBytes(9).toString('hex') + Date.now().toString(36);
}

const existing = db.listCustomers();
if (existing.length > 0) {
  if (!allowClear) {
    console.error(`数据库里已有 ${existing.length} 个客户，已取消导入。`);
    console.error('确认要重新导入请加 --clear（会先删除全部现有客户）。');
    process.exit(1);
  }
  console.log(`先清空 ${existing.length} 个现有客户...`);
  for (const c of existing) {
    db.deleteCustomer(c.id);
  }
}

const customers = require(path.resolve(jsonPath));
let ok = 0;
let skipped = 0;

for (const c of customers) {
  if (!c.name) {
    skipped += 1;
    continue;
  }
  const customer = {
    id: uid(),
    name: c.name,
    company: c.company || '',
    nationality: c.nationality || '',
    source: c.source || '',
    type: c.type || '',
    phone: c.phone || '',
    email: c.email || '',
    intent: ['high', 'medium', 'low'].includes(c.intent) ? c.intent : 'medium',
    createdAt: Number(c.createdAt) || Date.now(),
  };
  db.createCustomer(customer);
  ok += 1;
}

console.log(`导入完成：成功 ${ok} 条，跳过 ${skipped} 条。`);
console.log(`数据库现有客户总数：${db.listCustomers().length}`);
