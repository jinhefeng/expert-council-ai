async function run() {
  console.log("正在请求本地测试 API：http://127.0.0.1:3000/api/test-expert-crosstalk ...");
  try {
    const res = await fetch("http://127.0.0.1:3000/api/test-expert-crosstalk");
    const data = await res.json();
    console.log("响应结果:", JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("请求失败:", e);
  }
}
run();
