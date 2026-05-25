const http = require("http");

const PORT = process.env.PORT || 10000;

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("geupsiktalk minimal server is running.");
    return;
  }

  if (req.method === "POST" && req.url === "/skill") {
    let rawBody = "";
    req.on("data", chunk => {
      rawBody += chunk;
    });

    req.on("end", () => {
      sendJson(res, 200, {
        version: "2.0",
        template: {
          outputs: [
            {
              simpleText: {
                text: "급식톡 서버 연결 테스트 성공입니다 🍱\n이제 급식 조회 기능을 붙일 수 있습니다."
              }
            }
          ]
        }
      });
    });

    req.on("error", () => {
      sendJson(res, 500, { error: "request error" });
    });

    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`geupsiktalk minimal server listening on port ${PORT}`);
});

process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});
