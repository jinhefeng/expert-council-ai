import { extractAndCleanJson } from "@/lib/content-parser";

export async function GET() {
  const expertName = "品牌策略师";

  // 情况 1: 大模型由于首发无 context 诱导，直接脑补了别人的发言，在第一行就输出了其他人的名字
  const case1 = `【董事长】：这件事情成本必须要控制好，老员工优化势在必行！
\`\`\`json
{
  "stance": "支持优化",
  "concern": "成本过高",
  "recommendation": "逐步裁员",
  "tradeoff": "短期内可能影响开发效率"
}
\`\`\``;

  // 情况 2: 大模型正常开头，但是在后面脑补了其他角色
  const case2 = `【品牌策略师】：我认为品牌才是长期的核心，不能只盯着显性的人头成本。
【董事长】：你说得轻巧，公司发不出工资的时候，品牌有什么用？
\`\`\`json
{
  "stance": "支持留存",
  "concern": "品牌受损",
  "recommendation": "转为知识资产对赌",
  "tradeoff": "短期成本增加"
}
\`\`\``;

  // 情况 3: 正常无角色前缀的发言，只在结尾有 JSON
  const case3 = `作为品牌策略师，我认为不生孩子并非绝对不行。
\`\`\`json
{
  "stance": "中立",
  "concern": "无",
  "recommendation": "无",
  "tradeoff": "无"
}
\`\`\``;

  const result1 = extractAndCleanJson(case1, expertName);
  const result2 = extractAndCleanJson(case2, expertName);
  const result3 = extractAndCleanJson(case3, expertName);

  return Response.json({
    case1: {
      input: case1,
      cleaned: result1
    },
    case2: {
      input: case2,
      cleaned: result2
    },
    case3: {
      input: case3,
      cleaned: result3
    }
  });
}
