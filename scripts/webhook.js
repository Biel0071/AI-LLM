const http = require('http');
const { exec } = require('child_process');
const crypto = require('crypto');

const PORT = 9000;
const SECRET = process.env.WEBHOOK_SECRET || 'api-platform-secret-123';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      const sig = req.headers['x-hub-signature-256'];
      if (!sig) {
        res.writeHead(401);
        return res.end('No signature');
      }
      
      const hmac = crypto.createHmac('sha256', SECRET);
      const digest = 'sha256=' + hmac.update(body).digest('hex');
      
      if (sig !== digest) {
        res.writeHead(401);
        return res.end('Invalid signature');
      }

      console.log(`[Webhook] Push event received. Triggering update.sh...`);
      res.writeHead(200);
      res.end('Update triggered');

      exec('bash scripts/update.sh', (error, stdout, stderr) => {
        if (error) {
          console.error(`[Webhook] Exec error: ${error}`);
          return;
        }
        console.log(`[Webhook] Update output: ${stdout}`);
        if (stderr) console.error(`[Webhook] Update stderr: ${stderr}`);
      });
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`[API Platform] Webhook listener running on port ${PORT}`);
  console.log(`Configure GitHub to send POST requests to http://<seu-ip>:${PORT}/webhook com o secret: ${SECRET}`);
});
