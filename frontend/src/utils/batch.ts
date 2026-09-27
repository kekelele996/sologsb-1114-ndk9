import type { Station } from '@/types'

/** 新建批次在批次选择器中的占位值 */
export const NEW_BATCH = '__new_batch__'

/** 批次概要 */
export interface BatchInfo {
  /** 批次标签 */
  label: string
  /** 批次内测点数 */
  count: number
  /** 批次内最新测量日期 */
  date: string
}

/** 取测点所属批次标签；缺失时回落到测量日期（兼容未迁移数据） */
export function stationBatch(station: Pick<Station, 'batch' | 'date'>): string {
  return station.batch || station.date || '未分批次'
}

/**
 * 汇总测点序列中的批次，按时间先后升序（旧 → 新）。
 * 批次先后以批次内最新测量日期为准，日期相同再按标签排序。
 */
export function listBatches(stations: Station[]): BatchInfo[] {
  const map = new Map<string, BatchInfo>()
  for (const station of stations) {
    const label = stationBatch(station)
    const info = map.get(label) ?? { label, count: 0, date: '' }
    info.count += 1
    if (station.date && station.date > info.date) info.date = station.date
    map.set(label, info)
  }
  return [...map.values()].sort((a, b) =>
    a.date === b.date ? a.label.localeCompare(b.label, 'zh-Hans-CN') : a.date < b.date ? -1 : 1
  )
}

/** 最新一批的批次标签；无测点时返回 null */
export function latestBatchLabel(stations: Station[]): string | null {
  const batches = listBatches(stations)
  return batches.length > 0 ? batches[batches.length - 1].label : null
}

/** 取指定批次的测点 */
export function stationsOfBatch(stations: Station[], batch: string): Station[] {
  return stations.filter((station) => stationBatch(station) === batch)
}

/** 取最新一批的测点（复测时旧批次不参与当前结果） */
export function latestBatchStations(stations: Station[]): Station[] {
  const label = latestBatchLabel(stations)
  return label === null ? [] : stationsOfBatch(stations, label)
}
