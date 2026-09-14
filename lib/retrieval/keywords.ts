/**
 * 修改时间：2026-09-13
 * 文件说明：VaultAgent 中文与拉丁文本的轻量关键词提取。
 *
 * PostgreSQL 默认全文检索不具备中文分词器；DAY8 在既有 PostgreSQL 上采用可审计的
 * 中文双字词与完整短语匹配，不额外引入分词服务或数据库扩展
 * 简易版
 * edit by：Sliye
 */

/** 单次关键词 SQL 查询的词项上限，控制条件数量与扫描成本。 */
const MAX_KEYWORD_TERMS = 12;
/** 仅保留能区分内容的拉丁词，短词通常会带来过多无关命中。 */
const MIN_LATIN_TERM_LENGTH = 2;

/**
 * 将提问拆为可在文本中直接定位的关键词。
 *
 * 中文连续片段同时保留完整短语和相邻双字词；英文、数字、路径与版本号保留完整词。
 * 结果按首次出现去重，避免为同一词项重复生成 SQL 条件
 *
 * @param question 已在 API 边界完成长度校验的用户问题。
 */
export function extractKeywordTerms(question: string): string[] {
  const normalized = question.normalize("NFKC").toLocaleLowerCase("zh-CN");
  const terms: string[] = [];
  /**
   * 提取中文双子词
   * 例如 Docker 部署配置端口
   * 提取结果就是 部署 署配 配置 置端 端口 
   * 暂时不引入中文分词服务
   */
  for (const match of normalized.matchAll(/[\u3400-\u9fff]+/gu)) {
    const phrase = match[0];
    terms.push(phrase);
    if (phrase.length > 1) {
      for (let index = 0; index < phrase.length - 1; index += 1) {
        terms.push(phrase.slice(index, index + 2));
      }
    }
  }
  /**
   * 提取英文、数字、版本号和路径
   * 长度小于2忽略
   */

  for (const match of normalized.matchAll(/[\p{L}\p{N}][\p{L}\p{N}._/-]*/gu)) {
    const term = match[0];
    if (term.length >= MIN_LATIN_TERM_LENGTH) terms.push(term);
  }
  // 去重并限制最多12个
  return [...new Set(terms)].slice(0, MAX_KEYWORD_TERMS);
}
