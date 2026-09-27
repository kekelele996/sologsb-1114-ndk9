/** SurveyBatch 测量批次：同一洞段一次外业测量得到的测点集合，复测时新建批次与旧记录隔离 */
export interface SurveyBatch {
  id: string
  segmentId: string
  /** 批次测量日期 */
  date: string
  /** 批次名称，如 第2批 */
  label: string
  /** 创建时间（ISO），用于排列「最近一次」批次 */
  createdAt: string
}
