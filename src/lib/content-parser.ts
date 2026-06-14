export interface ExpertStance {
  stance: string;
  concern: string;
  recommendation: string;
  tradeoff: string;
}

/**
 * 极其稳健的专家发言清洗与 JSON 立场摘要提取算法。
 * 1. 过滤基本的思维链标记 <think>...</think>
 * 2. 动态进行剧本角色串扰物理斩断：遇到 \n【其他角色名字】： 时在此处切断
 * 3. 倒序基于关键字 stance/concern 等锁定核心 JSON 块，规避前置英文独白泄露的混淆 {}
 * 4. 自动为被 Token 截断的破损 JSON 补齐缺失的引号与大括号，恢复可解析状态
 * 5. Fallback 字段正则匹配兜底
 * 
 * @param rawText 原始文本流
 * @param expertName 当前发言专家的自定义名字（动态匹配截断）
 */
export function extractAndCleanJson(rawText: string, expertName: string): {
  content: string;
  expertStance: ExpertStance;
} {
  let text = rawText || "";
  let thinkBlock = "";

  // 1. 提取并暂存 <think>...</think> 思维链（兼容可能被截断未闭合的 think 块）
  const thinkMatch = text.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
  if (thinkMatch) {
    thinkBlock = thinkMatch[0];
    text = text.split(thinkBlock).join("");
  }

  // 1.2 强力剪除前导泄露的调试前缀与长篇英文任务解读（定位真正的中文发言起点，使用3个连续汉字防止专家名字等短中文词汇提前终止匹配）
  text = text.replace(/^[\s\n]*Council\s*(?:We need to|Must|The user wants|As a|Need to|Ensure|We should)[\s\S]*?(?=\n\n|[\u4e00-\u9fa5]{3,})/i, "");
  text = text.trim();

  // 1.3 强力剪除可能复述的中文【安全提示/系统提示】前缀整行
  text = text.replace(/^[\s\n]*【(?:安全提示|系统提示|提示)】[^\n]*/gi, "");
  text = text.trim();

  // 1.4 智能剥离中文客套话、扮演确认语等前导碎碎念
  const myCoreName = (expertName || "").split(/[\s(（]/)[0].trim();
  if (myCoreName) {
    // 匹配 "好的，我将扮演专家小蔚进行发言：" 或 "小蔚发言如下：" 或 "我的发言如下：" 等
    const chinesePreamblePattern = new RegExp(
      `^[\\s\\n]*(?:好的|收到|明白|遵命)?[，。]?(?:我将|我需要|接下来我将)?(?:代表|扮演)?(?:专家)?(?:${myCoreName})?(?:的身份)?(?:发表|进行)?(?:本次|关于此议题的)?(?:发言|评论|视角|意见|回答)?[：:\\s\\n]*(?:我的(?:具体)?发言如下|以下是我的发言|发言如下)?[：:\\s\\n]*`,
      "i"
    );
    text = text.replace(chinesePreamblePattern, "");
  }
  text = text.trim();

  // 2. 动态剧本角色串扰截断 (Crosstalk Truncation)
  // 如果文本中包含 \n【角色名】 或 【角色名】，且角色名与本专家不同，说明大模型脑补了剧本续写。
  // 我们检测：在新起一行出现 【xxx】 且 xxx !== expertName 的情况。
  // 我们支持 【角色】、 【角色(Title)】、 【角色 (Title)】 等格式匹配。
  // 比如：【董事长】 或者 【董事长 (董事长)】 都是代表角色。
  // 我们用正则解析出中括号内的文本，剥离其可能含有的括号备注，然后比对。
  const lines = text.split("\n");
  let cutIndex = -1;
  let charCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 匹配类似: 【董事长】： 或 【董事长 (董事长)】： 或 【主持人】：
    const match = line.match(/^【([^】]+)】\s*[:：]/) || line.match(/【([^】]+)】\s*[:：]/);
    if (match) {
      const capturedNameWithTitle = match[1].trim();
      // 提取核心名字，例如从 "董事长 (董事长)" 中提取 "董事长"
      const coreName = capturedNameWithTitle.split(/[\s(（]/)[0].trim();
      const myCoreName = (expertName || "").split(/[\s(（]/)[0].trim();

      // 如果这个前缀不是本专家自己，则断定为幻觉多角色脑补，立即切断！
      if (coreName && coreName !== myCoreName && coreName !== "你" && coreName !== "me") {
        // 我们在这一行的起始位置切断
        cutIndex = charCounter;
        break;
      }
    }
    // 加 1 是因为 split("\n") 丢掉了换行符的长度
    charCounter += line.length + 1;
  }

  if (cutIndex !== -1) {
    text = text.substring(0, cutIndex).trim();
  }

  // 3. 定位核心 JSON 块
  // 关键字集合（立场卡片特有键）
  const keywords = ["stance", "concern", "recommendation", "tradeoff"];
  let lastKeywordPos = -1;

  for (const kw of keywords) {
    // 兼容可能的大写或单双引号
    const doubleQuotePos = text.lastIndexOf(`"${kw}"`);
    const singleQuotePos = text.lastIndexOf(`'${kw}'`);
    const pos = Math.max(doubleQuotePos, singleQuotePos);
    if (pos > lastKeywordPos) {
      lastKeywordPos = pos;
    }
  }

  let jsonStartIdx = -1;
  if (lastKeywordPos !== -1) {
    // 从该关键字倒序查找最近的 '{'
    jsonStartIdx = text.lastIndexOf("{", lastKeywordPos);
  }

  let jsonString = "";
  let jsonOriginalBlock = "";

  if (jsonStartIdx !== -1) {
    // 尝试往后寻找闭合的大括号
    let braceCount = 0;
    let jsonEndIdx = -1;
    let inString = false;
    let escape = false;

    for (let i = jsonStartIdx; i < text.length; i++) {
      const char = text[i];
      
      // 处理字符串中的转义字符
      if (char === '\\' && !escape) {
        escape = true;
        continue;
      }

      if (char === '"' && !escape) {
        inString = !inString;
      }
      
      escape = false; // 重置转义标记

      if (!inString) {
        if (char === "{") braceCount++;
        if (char === "}") {
          braceCount--;
          if (braceCount === 0) {
            jsonEndIdx = i;
            break;
          }
        }
      }
    }

    if (jsonEndIdx !== -1) {
      // 成功捕获完整闭合的 JSON 块
      // 核心算法：向两侧进行自适应吞并 Markdown 代码块标记（```json 与 ```）
      let finalStartIdx = jsonStartIdx;
      let finalEndIdx = jsonEndIdx;

      // 向上寻找并吞掉 ```json 类似的标志及多余空白/换行
      const prefixText = text.substring(0, jsonStartIdx);
      const prefixMatch = prefixText.match(/```[a-zA-Z]*\s*$/);
      if (prefixMatch) {
        finalStartIdx = prefixText.length - prefixMatch[0].length;
      }

      // 向下寻找并吞掉 ``` 类似的标志及多余空白/换行
      const suffixText = text.substring(jsonEndIdx + 1);
      const suffixMatch = suffixText.match(/^\s*```/);
      if (suffixMatch) {
        finalEndIdx = jsonEndIdx + 1 + suffixMatch[0].length - 1;
      }

      jsonOriginalBlock = text.substring(finalStartIdx, finalEndIdx + 1);
      jsonString = text.substring(jsonStartIdx, jsonEndIdx + 1);
    } else {
      // 未闭合，说明大模型在输出 JSON 期间遭遇 Token 截断！
      jsonOriginalBlock = text.substring(jsonStartIdx);
      
      // 尝试对未闭合的代码块前缀进行吞并
      const prefixText = text.substring(0, jsonStartIdx);
      const prefixMatch = prefixText.match(/```[a-zA-Z]*\s*$/);
      if (prefixMatch) {
        jsonOriginalBlock = text.substring(prefixText.length - prefixMatch[0].length);
      }

      // 执行闭合自适应补齐算法：
      let repairStr = text.substring(jsonStartIdx).trim();

      // A. 引号补齐：如果在最后一个双引号后，跟着拼写未完成的文本，且有奇数个双引号
      let quoteCount = 0;
      for (let j = 0; j < repairStr.length; j++) {
        if (repairStr[j] === '"' && (j === 0 || repairStr[j - 1] !== '\\')) {
          quoteCount++;
        }
      }
      if (quoteCount % 2 !== 0) {
        repairStr += '"'; // 补上未闭合的右侧引号
      }

      // B. 大括号补全
      let openBraces = 0;
      for (const char of repairStr) {
        if (char === "{") openBraces++;
        if (char === "}") {
          openBraces--;
        }
      }
      for (let k = 0; k < openBraces; k++) {
        repairStr += "}";
      }

      jsonString = repairStr;
    }
  }

  // 4. 解析卡片字段 (带 Failback 正则兜底)
  let stance = "暂无立场摘要";
  let concern = "暂无风险摘要";
  let recommendation = "暂无建议摘要";
  let tradeoff = "暂无取舍摘要";

  if (jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      stance = parsed.stance || stance;
      concern = parsed.concern || concern;
      recommendation = parsed.recommendation || recommendation;
      tradeoff = parsed.tradeoff || tradeoff;
    } catch (e) {
      // JSON 解析失败时的正则强力提取 (针对格式破损或半截字段)
      const matchField = (field: string) => {
        // 标准格式："field" : "value"
        const regex = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`);
        const res = jsonString.match(regex);
        if (res && res[1]) return res[1];

        // 兼容截断无末尾引号的字段格式："field" : "部分内容... (截断)
        const partialRegex = new RegExp(`"${field}"\\s*:\\s*"([^"]*)$`);
        const partialRes = jsonString.match(partialRegex);
        return partialRes ? partialRes[1] : "";
      };
      
      stance = matchField("stance") || stance;
      concern = matchField("concern") || concern;
      recommendation = matchField("recommendation") || recommendation;
      tradeoff = matchField("tradeoff") || tradeoff;
    }

    // 从原文中彻底抹去匹配到的 JSON 块（并丢弃 JSON 块之后的一切大模型幻觉复述或残留文本）
    const idx = text.indexOf(jsonOriginalBlock);
    if (idx !== -1) {
      text = text.substring(0, idx);
    }
  }

  // 5. 额外清理残留的代码块标记 (```json 等) 及空白符号，自动剥离任何首尾多余的代码块套壳符号防止未闭合渲染故障
  text = text
    .replace(/^```[a-zA-Z]*\s*/, "") // 清理开头的 ```json 等
    .replace(/```\s*$/, "")          // 清理结尾的 ```
    .replace(/[\s\n\]\[`]+$/, "")
    .trim();

  // 6. 清除 "Council" 前导调试系统泄露 (仅匹配开头前缀，防止误杀发言正文中的 Design Council 等词汇)
  text = text.replace(/^[\s\n]*Council\s*/i, "");

  const finalContent = thinkBlock ? `${thinkBlock}\n\n${text}`.trim() : text;

  return {
    content: finalContent,
    expertStance: { stance, concern, recommendation, tradeoff }
  };
}

/**
 * 流式过程中，在前台实时预测并裁剪掉尾部的 JSON 块。
 * 兼具特征指纹识别（包含 stance/concern 等关键字）和距离防抖前置机制，防止 JSON 字符污染聊天气泡。
 */
export function cleanStreamingJson(text: string): string {
  if (!text) return "";

  const idxJson = text.lastIndexOf("```json");
  const idxBackticks = text.lastIndexOf("```");

  let idxBrace = -1;
  const braceMatches = [...text.matchAll(/[\s\n]\{/g)];
  if (braceMatches.length > 0) {
    idxBrace = braceMatches[braceMatches.length - 1].index!;
  }

  let startIdx = -1;
  if (idxJson !== -1) {
    startIdx = idxJson;
  } else if (idxBackticks !== -1) {
    startIdx = idxBackticks;
  } else if (idxBrace !== -1) {
    startIdx = idxBrace;
  }

  if (startIdx !== -1) {
    const remainingText = text.substring(startIdx);
    const hasStanceKey = /"stance"|'stance'|stance\s*:/i.test(remainingText) ||
                          /"concern"|'concern'|concern\s*:/i.test(remainingText) ||
                          /"recommendation"|'recommendation'|recommendation\s*:/i.test(remainingText) ||
                          /"tradeoff"|'tradeoff'|tradeoff\s*:/i.test(remainingText);

    const distToTrail = text.length - startIdx;
    // 命中指纹，或者虽未命中指纹但距离尾端极近（前置防抖，例如刚吐出 ```json ），立即裁剪阻断
    if (hasStanceKey || distToTrail < 15) {
      return text.substring(0, startIdx).trim();
    }
  }

  return text;
}
