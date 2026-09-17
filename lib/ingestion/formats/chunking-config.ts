/** 修改时间：2026-09-17 | 文件说明：各文档解析器与监控共用的切块预算 | edit by：Sliye */
/** 目标文本块字符预算；格式边界和不可拆结构仍由各解析器决定，不等于 Token 数。 */
export const MAX_CHUNK_CHARACTERS = 1_400;
/** 当前格式感知切块策略版本，修改切块行为时同步更新。 */
export const CHUNKING_VERSION = "format-aware-v1";
