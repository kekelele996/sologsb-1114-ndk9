import { createStore } from 'zustand/vanilla'
import type { SurveyBatch } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'
import { uid } from '@/utils/id'

export interface BatchState {
  batches: SurveyBatch[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (batch: SurveyBatch) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const batchStore = createStore<BatchState>((set, get) => ({
  batches: [],
  loaded: false,
  hydrate: async () => {
    const batches = await syncAll<SurveyBatch>(db.batches)
    batches.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    set({ batches, loaded: true })
  },
  save: async (batch) => {
    await syncPut<SurveyBatch>(db.batches, batch)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete(db.batches, id)
    await get().hydrate()
  }
}))

/** 某洞段的全部批次，按创建时间升序（最早在前） */
export function batchesOfSegment(batches: SurveyBatch[], segmentId: string): SurveyBatch[] {
  return batches
    .filter((batch) => batch.segmentId === segmentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** 某洞段最近一次批次（当前批次） */
export function latestBatchOfSegment(batches: SurveyBatch[], segmentId: string): SurveyBatch | undefined {
  const list = batchesOfSegment(batches, segmentId)
  return list[list.length - 1]
}

/** 为洞段新建一个批次（复测场景），批次名按已有批次数自动编号 */
export function buildBatch(segmentId: string, date: string, existingCount: number): SurveyBatch {
  return {
    id: uid('batch'),
    segmentId,
    date,
    label: `第${existingCount + 1}批`,
    createdAt: new Date().toISOString()
  }
}
