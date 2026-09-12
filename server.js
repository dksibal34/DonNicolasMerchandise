const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;


function paymentStatus(order) { const paid = order.payments.reduce((sum, p) => sum + p.amount, 0); return paid >= order.total ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid'; }
function present(order) { const paid = order.payments.reduce((sum, p) => sum + p.amount, 0); return { ...order, paid, balance: Math.max(0, order.total - paid), status: paymentStatus(order) }; }
function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', c => body += c); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid request body')); } }); }); }
function validate(body) { return body.customer && body.number && body.date && body.products && Number(body.total) > 0 && body.terms && body.dueDate && body.deliveryStatus; }
function orderFields(body, existing = {}) { return { ...existing, number: String(body.number).trim(), customer: String(body.customer).trim(), date: body.date, products: String(body.products).trim(), total: Number(body.total), terms: body.terms, dueDate: body.dueDate, deliveryStatus: body.deliveryStatus, deliveryDate: body.deliveryDate || '', deliveryNote: body.deliveryNote || '' }; }
function report(res) { const active = orders.filter(o => !o.archived).map(present), today = new Date().toISOString().slice(0, 10); json(res, 200, { outstanding: active.reduce((s, o) => s + o.balance, 0), overdue: active.filter(o => o.balance && o.dueDate < today).reduce((s, o) => s + o.balance, 0), monthly: active.flatMap(o => o.payments).filter(p => p.date.slice(0, 7) === today.slice(0, 7)).reduce((s, p) => s + p.amount, 0) }); }
function sales(res) {
  const active = orders.filter(o => !o.archived).map(present);
  const months = {};
  active.forEach(o => { const month = o.date.slice(0, 7); if (!months[month]) months[month] = { month, sales: 0, collections: 0, orders: 0 }; months[month].sales += o.total; months[month].orders++; o.payments.forEach(p => { if (p.date.slice(0, 7) === month) months[month].collections += p.amount; }); });
  const totalSales = active.reduce((sum, o) => sum + o.total, 0), collections = active.reduce((sum, o) => sum + o.paid, 0);
  json(res, 200, { totalSales, collections, receivables: totalSales - collections, delivered: active.filter(o => o.deliveryStatus === 'Delivered').length, ongoing: active.filter(o => o.deliveryStatus === 'Ongoing Delivery').length, pending: active.filter(o => o.deliveryStatus === 'Undelivered').length, monthly: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)) });
}
function serve(res, file) { const type = path.extname(file) === '.css' ? 'text/css' : path.extname(file) === '.js' ? 'application/javascript' : 'text/html'; fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end('Not found'); } else { res.writeHead(200, { 'Content-Type': type }); res.end(data); } }); }

http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  try {
    if (req.method === 'GET' && pathname === '/api/orders') return json(res, 200, orders.map(present));
    if (req.method === 'GET' && pathname === '/api/reports') return report(res);
    if (req.method === 'GET' && pathname === '/api/sales') return sales(res);
    if (req.method === 'POST' && pathname === '/api/orders') { const body = await readBody(req); if (!validate(body)) return json(res, 400, { message: 'Please complete all required order and delivery fields.' }); const order = { id: Date.now(), ...orderFields(body), archived: false, payments: [] }; orders.unshift(order); return json(res, 201, present(order)); }
    const payment = pathname.match(/^\/api\/orders\/(\d+)\/payments$/);
    if (req.method === 'POST' && payment) { const order = orders.find(o => o.id === Number(payment[1])); const body = await readBody(req), amount = Number(body.amount); if (!order) return json(res, 404, { message: 'Order not found.' }); if (!amount || amount <= 0 || amount > present(order).balance) return json(res, 400, { message: 'Enter a payment amount within the remaining balance.' }); order.payments.push({ amount, date: body.date || new Date().toISOString().slice(0, 10) }); return json(res, 200, present(order)); }
    const item = pathname.match(/^\/api\/orders\/(\d+)$/);
    if (item && req.method === 'PUT') { const order = orders.find(o => o.id === Number(item[1])), body = await readBody(req); if (!order) return json(res, 404, { message: 'Order not found.' }); if (!validate(body)) return json(res, 400, { message: 'Please complete all required order and delivery fields.' }); Object.assign(order, orderFields(body, order)); return json(res, 200, present(order)); }
    if (item && req.method === 'DELETE') { const index = orders.findIndex(o => o.id === Number(item[1])); if (index < 0) return json(res, 404, { message: 'Order not found.' }); orders.splice(index, 1); return json(res, 200, { message: 'Order removed.' }); }
    const archive = pathname.match(/^\/api\/orders\/(\d+)\/archive$/);
    if (archive && req.method === 'POST') { const order = orders.find(o => o.id === Number(archive[1])); if (!order) return json(res, 404, { message: 'Order not found.' }); order.archived = !order.archived; return json(res, 200, present(order)); }
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) return serve(res, path.join(__dirname, 'public', 'index.html'));
    if (req.method === 'GET' && ['/styles.css', '/app.js'].includes(pathname)) return serve(res, path.join(__dirname, 'public', pathname));
    res.writeHead(404); res.end('Not found');
  } catch (err) { json(res, 400, { message: err.message || 'Invalid request.' }); }
}).listen(PORT, () => console.log(`Client Order Manager running at http://localhost:${PORT}`));
