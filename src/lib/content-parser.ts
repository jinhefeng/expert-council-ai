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
export function extractAndCleanJson(rawText: string, expertName: string, expertTitle?: string): {
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
  const myCoreTitle = (expertTitle || "").split(/[\s(（]/)[0].trim();
  let hasStrippedSelfPrefix = false;
  // 收集需要匹配的所有身份标识（name + title 去重），解决大模型用头衔（如"董事长"）自称时正则无法命中的问题
  const identityTokens = [...new Set([myCoreName, myCoreTitle].filter(Boolean))];
  if (identityTokens.length > 0) {
    // 1.4.1 强力剥离当前专家本人的角色名及头衔的各种前缀变体（如 【董事长】：、董事长：、董事长发言如下：等，支持中括号及换行变体）
    const identityAlt = identityTokens.join("|");
    const selfPrefixPattern = new RegExp(
      `^[\\s\\n]*(?:【[^】]*(?:${identityAlt})[^】]*】|(?:${identityAlt})[^：:\\n]*)[\\s\\n]*(?:[：:发言]+|\\n+)[\\s\\n]*`,
      "i"
    );
    if (selfPrefixPattern.test(text)) {
      text = text.replace(selfPrefixPattern, "");
      hasStrippedSelfPrefix = true;
    }

    // 1.4.2 匹配 "好的，我将扮演专家小蔚进行发言：" 或 "小蔚发言如下：" 或 "我的发言如下：" 等
    const identityPreambleAlt = identityTokens.join("|");
    const chinesePreamblePattern = new RegExp(
      `^[\\s\\n]*(?:好的|收到|明白|遵命)?[，。]?(?:我将|我需要|接下来我将)?(?:代表|扮演)?(?:专家)?(?:${identityPreambleAlt})?(?:的身份)?(?:发表|进行)?(?:本次|关于此议题的)?(?:发言|评论|视角|意见|回答)?[：:\\s\\n]*(?:我的(?:具体)?发言如下|以下是我的发言|发言如下)?[：:\\s\\n]*`,
      "i"
    );
    text = text.replace(chinesePreamblePattern, "");
  }
  text = text.trim();

  // 3. 先定位并提取核心 JSON 块
  let jsonStartIdx = -1;
  let searchPos = text.length;

  while (true) {
    if (searchPos <= 0) break;
    const braceIdx = text.lastIndexOf("{", searchPos - 1);
    if (braceIdx === -1) break;

    const tailText = text.substring(braceIdx);
    // 检测该 `{` 后面是否包含立场卡片这四个特征关键字中的任意一个
    const hasKeywords = /stance|concern|recommendation|tradeoff/i.test(tailText);
    // 同时检测该 `{` 后面是否属于典型的 JSON 起头模式（大括号后面跟着空格/引号/字符等）
    const isJsonPattern = /^\{\s*["'\w\s]/i.test(tailText);

    if (hasKeywords && isJsonPattern) {
      jsonStartIdx = braceIdx;
      break;
    }

    searchPos = braceIdx; // 继续往前寻找上一个大括号
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

      // 调用状态机物理修复机制进行高鲁棒自愈：
      jsonString = repairJson(text.substring(jsonStartIdx));
    }
  }

  // 4. 解析卡片字段 (带 Failback 正则兜底)
  let stance = "暂无立场摘要";
  let concern = "暂无风险摘要";
  let recommendation = "暂无建议摘要";
  let tradeoff = "暂无取舍摘要";

  if (jsonString) {
    const parsed = cleanAndParseJson<any>(jsonString);
    if (parsed) {
      stance = parsed.stance || stance;
      concern = parsed.concern || concern;
      recommendation = parsed.recommendation || recommendation;
      tradeoff = parsed.tradeoff || tradeoff;
    } else {
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

  // 2. 后进行：动态剧本角色串扰截断 (Crosstalk Truncation)
  // 如果文本中包含 \n【角色名】 或 【角色名】，且角色名与本专家不同，说明大模型脑补了剧本续写。
  // 我们检测：在新起一行出现 【xxx】 且 xxx !== expertName 的情况。
  const lines = text.split("\n");
  let cutIndex = -1;
  let charCounter = 0;
  let modified = false;
  let hasEnteredMyTurn = hasStrippedSelfPrefix;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 匹配类似: 【董事长】： 或 【董事长 (董事长)】： 或 【主持人】：
    const match = line.match(/^【([^】]+)】\s*[:：]/) || line.match(/【([^】]+)】\s*[:：]/);
    if (match) {
      const capturedNameWithTitle = match[1].trim();
      // 提取核心名字，例如从 "董事长 (董事长)" 中提取 "董事长"
      const coreName = capturedNameWithTitle.split(/[\s(（]/)[0].trim();
      const myCoreName = (expertName || "").split(/[\s(（]/)[0].trim();

      // 增强判定：如果捕获的名称中包含了当前专家的核心名字，或者当前专家的核心名字包含了捕获的名称，我们就认为它是本专家，不属于角色串扰
      const isSelf = 
        coreName === myCoreName || 
        capturedNameWithTitle.includes(myCoreName) || 
        myCoreName.includes(coreName);

      if (isSelf) {
        hasEnteredMyTurn = true;
      } else if (coreName && coreName !== "你" && coreName !== "me") {
        // 如果是其他角色的假前缀
        // 安全防线：如果还没有进入本专家的发言区且在前100个字符内，我们仅擦除该假角色前缀，而不执行整篇完全截断
        if (!hasEnteredMyTurn && charCounter < 100) {
          lines[i] = line.replace(match[0], "").trim();
          modified = true;
          hasEnteredMyTurn = true; // 擦除前导假前缀后，后续应视为已进入正文区
        } else {
          // 后置假前缀，在这一行的起始位置切断
          cutIndex = charCounter;
          break;
        }
      }
    } else {
      // 如果没有匹配到前缀，且该行有实质内容（长度大于10），可视为进入正文发言区
      if (line.trim().length > 10) {
        hasEnteredMyTurn = true;
      }
    }
    // 加 1 是因为 split("\n") 丢掉了换行符的长度
    charCounter += line.length + 1;
  }

  if (cutIndex !== -1) {
    let currentLen = 0;
    const cutLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (currentLen >= cutIndex) break;
      cutLines.push(lines[i]);
      currentLen += lines[i].length + 1;
    }
    text = cutLines.join("\n").trim();
  } else if (modified) {
    text = lines.join("\n").trim();
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
  let searchPos = text.length;

  while (true) {
    if (searchPos <= 0) break;
    const braceIdx = text.lastIndexOf("{", searchPos - 1);
    if (braceIdx === -1) break;

    const tailText = text.substring(braceIdx);
    const hasKeywords = /stance|concern|recommendation|tradeoff/i.test(tailText);
    const isJsonPattern = /^\{\s*["'\w\s]/i.test(tailText);

    if (hasKeywords && isJsonPattern) {
      idxBrace = braceIdx;
      break;
    }
    searchPos = braceIdx;
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

/**
 * 编译器词法状态机级别的 JSON 物理修复器（自愈机制）
 * 1. 精准遍历单/双引号以跳过字符串内容，防止字符串内字符混淆结构
 * 2. 对截断未闭合的双引号字符串自动补充右引号
 * 3. 自动修补冒号 ":" 后面缺失的空值，以及多余的末尾逗号 ","
 * 4. 采用后进先出栈（Stack）机制，100% 确定性地闭合未结束的大括号和中括号
 */
export function repairJson(jsonStr: string): string {
  let s = jsonStr.trim();
  if (!s) return "{}";

  let inString = false;
  let isEscaped = false;
  const stack: ("{" | "[")[] = [];
  const chars = s.split("");

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];

    if (inString) {
      if (char === "\\") {
        isEscaped = !isEscaped;
      } else if (char === '"' && !isEscaped) {
        inString = false;
      } else {
        isEscaped = false;
      }
    } else {
      if (char === '"') {
        inString = true;
        isEscaped = false;
      } else if (char === "{") {
        stack.push("{");
      } else if (char === "[") {
        stack.push("[");
      } else if (char === "}") {
        if (stack[stack.length - 1] === "[") {
          // 自动纠正：在大括号 } 闭合处如果是数组，说明模型把 ] 错写成了 }。
          // 将其纠正为 ]，并弹出栈顶中括号。
          chars[i] = "]";
          stack.pop();
        } else if (stack[stack.length - 1] === "{") {
          stack.pop();
        }
      } else if (char === "]") {
        if (stack[stack.length - 1] === "[") {
          stack.pop();
        }
      }
    }
  }

  let repaired = chars.join("");

  // 转义截断修复
  if (inString && isEscaped) {
    repaired = repaired.slice(0, -1);
  }

  // 双引号闭合
  if (inString) {
    repaired += '"';
  }

  // 修复非法字段结尾
  const trimmed = repaired.trim();
  if (trimmed.endsWith(":")) {
    repaired += ' ""';
  } else if (trimmed.endsWith(",")) {
    repaired = repaired.slice(0, repaired.lastIndexOf(","));
  }

  // 括号倒序出栈补齐
  for (let i = stack.length - 1; i >= 0; i--) {
    const brace = stack[i];
    if (brace === "{") repaired += "}";
    if (brace === "[") repaired += "]";
  }

  return repaired;
}

/**
 * 编译器级别状态机：转义 JSON 双引号字符串值内部的真实控制字符（如实际换行符、制表符）
 * 从而彻底防范 JSON.parse 抛出 "Bad control character in string literal" 的致命错误
 */
export function sanitizeJsonString(rawJson: string): string {
  let result = "";
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < rawJson.length; i++) {
    const char = rawJson[i];

    if (inString) {
      if (char === "\\") {
        isEscaped = !isEscaped;
        result += char;
      } else if (char === '"' && !isEscaped) {
        inString = false;
        result += char;
      } else {
        isEscaped = false;
        // 如果在大括号字符串字面量内部，遇到实际的控制字符，将其转义为标准 JSON 字符
        if (char === "\n") {
          result += "\\n";
        } else if (char === "\r") {
          result += "\\r";
        } else if (char === "\t") {
          result += "\\t";
        } else {
          result += char;
        }
      }
    } else {
      if (char === '"') {
        inString = true;
        isEscaped = false;
      }
      result += char;
    }
  }
  return result;
}

/**
 * 稳健解析破损或带有 LaTeX、非标准转义、非法控制字符的 JSON 字符串
 */
export function cleanAndParseJson<T>(jsonStr: string): T | null {
  if (!jsonStr) return null;
  try {
    // 1. 转义控制字符 (防止 Bad control character)
    const sanitized = sanitizeJsonString(jsonStr);
    // 2. 解决 LaTeX 公式中单反斜杠被误作非法转义字符的缺陷
    const doubleSlashed = sanitized.replace(/\\(?!["\\\/n]|u[0-9a-fA-F]{4})/g, "\\\\");
    // 3. 解析
    return JSON.parse(doubleSlashed) as T;
  } catch (e) {
    // 4. 解析失败时尝试用 repairJson 自愈闭合再解析一次
    try {
      const repaired = repairJson(jsonStr);
      const sanitizedRep = sanitizeJsonString(repaired);
      const doubleSlashedRep = sanitizedRep.replace(/\\(?!["\\\/n]|u[0-9a-fA-F]{4})/g, "\\\\");
      return JSON.parse(doubleSlashedRep) as T;
    } catch (innerErr) {
      return null;
    }
  }
}

/**
 * 智能序号与分号列表折行美化器 (List Beautifier)
 * 针对大模型在 JSON 字段中连续写出的序号或分号列表，智能在序列前插入换行符，以便 Markdown 正确折行展示
 */
export function beautifyListFormatting(text: string): string {
  if (!text) return "";
  
  // 1. 针对分号或句号后面，紧跟数字点序号或中文序号的情况，追加换行
  // 例如：'1. xx； 2. xx' -> '1. xx；\n2. xx'
  let formatted = text.replace(/([;；。])\s*(?=\d+[\.、]|[一二三四五六七八九十]+[、\.])/g, "$1\n");
  
  // 2. 针对首行没有换行，且以数字序号分隔且前置有较长文本的情况，做智能切分
  // 比如 "我的建议是：1. 兼容性测试 2. 执行热替换"
  // 我们检测：数字序号前为普通字词（非空格或标点），在此处插入换行
  formatted = formatted.replace(/(?<=[^\s\d;；。，,])\s+(?=\d+[\.、]|[一二三四五六七八九十]+[、\.])/g, "\n");
  
  return formatted;
}

/**
 * 稳健的“末位检索与自适应截断”提取算法，只抓取最后一个真正的 <inquiry> 提问包裹块，
 * 彻底隔离大模型在前面为了构思而说出的英文废话或 <inquiry> 单词泄露。
 */
export function extractInquiryPrompt(text: string): string {
  if (!text) return "";
  const lastInquiryIdx = text.lastIndexOf("<inquiry>");
  if (lastInquiryIdx === -1) return "";
  
  let content = text.substring(lastInquiryIdx + 9); // "<inquiry>".length === 9
  const closeIdx = content.indexOf("</inquiry>");
  if (closeIdx !== -1) {
    content = content.substring(0, closeIdx);
  }
  return content.trim();
}

/**
 * 极其稳健的通用流式残损 JSON 属性值提取器
 * 支持在流式输出（JSON 尚未闭合且残缺）时，实时提取指定 Key 的 String 值，并自动还原转义字符。
 * 
 * @param text 正在吐流的原始文本（残缺 JSON）
 * @param key 需要提取的属性键名（例如 "summary" 或 "stance"）
 */
export function extractStreamingJsonKey(text: string, key: string): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return text; // 退化情况：非 JSON 结构直接透传
  }

  // 动态构造匹配键的正则，支持单/双引号及空格：如 "summary"\s*:\s*"
  const keyPattern = new RegExp(`["']${key}["']\\s*:\\s*["']`);
  const match = trimmed.match(keyPattern);
  if (!match) return "";

  const startIdx = (match.index ?? 0) + match[0].length;
  let endIdx = -1;
  let escape = false;

  // 扫描寻找该属性值字符串的结束双引号（排除转义引号）
  for (let i = startIdx; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"' || char === "'") {
      endIdx = i;
      break;
    }
  }

  let rawValue = "";
  if (endIdx !== -1) {
    rawValue = trimmed.substring(startIdx, endIdx);
  } else {
    rawValue = trimmed.substring(startIdx);
    if (rawValue.endsWith("\\")) {
      rawValue = rawValue.slice(0, -1); // 保护正在吐出中的转义斜杠
    }
  }

  // 还原转义字符，保证 Markdown 换行及符号正常渲染
  return rawValue
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

/**
 * 判断正在吐流的残破 JSON 文本中，指定 key 的字符串值是否已经输出完毕并成功闭合。
 * 
 * @param text 正在吐流的原始文本（残损 JSON）
 * @param key 属性键名
 */
export function isStreamingJsonKeyClosed(text: string, key: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }

  const keyPattern = new RegExp(`["']${key}["']\\s*:\\s*["']`);
  const match = trimmed.match(keyPattern);
  if (!match) return false;

  const startIdx = (match.index ?? 0) + match[0].length;
  let escape = false;

  for (let i = startIdx; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"' || char === "'") {
      return true; // 找到了闭合的引号，说明该 key 已经读取完毕了
    }
  }
  return false;
}
