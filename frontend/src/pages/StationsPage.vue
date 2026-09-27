<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Station } from '@/types'
import BearingInput from '@/components/common/BearingInput.vue'
import ClosureBadge from '@/components/common/ClosureBadge.vue'
import SegmentTag from '@/components/common/SegmentTag.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { useClosureCheck } from '@/hooks/useClosureCheck'
import { segmentStore } from '@/stores/segmentStore'
import { stationStore } from '@/stores/stationStore'
import { caveStore } from '@/stores/caveStore'
import { computeHorizontal, computeVertical, formatDms, isValidBearing, isValidDip } from '@/utils/survey'
import { NEW_BATCH, listBatches, stationBatch, stationsOfBatch } from '@/utils/batch'
import { nextCode, uid } from '@/utils/id'

const caveState = useStore(caveStore)
const segmentState = useStore(segmentStore)
const stationState = useStore(stationStore)

const selectedCaveId = ref<string>(caveState.caves[0]?.id ?? '')
const selectedSegmentId = ref<string>('')
const editingId = ref<string | null>(null)
const lastSaved = ref<string>('')
/** 当前批次：录入、闭合差、桩号序号与读数表都只统计该批次 */
const selectedBatch = ref<string>('')
/** 新建批次的批次名（默认取测量日期） */
const newBatchLabel = ref<string>('')
/** 用户手动选择「新建批次」时为 true，避免被自动回落覆盖 */
const keepNewBatch = ref<boolean>(false)

const form = reactive({
  code: 'P1',
  bearing: 90,
  dip: 0,
  slopeDistance: 10,
  instrumentNo: 'SOKKIA-2',
  surveyor: '',
  date: new Date().toISOString().slice(0, 10),
  isClosurePoint: false,
  note: ''
})

const cavesWithSegments = computed(() => caveState.caves)
const segmentOptions = computed(() =>
  segmentState.segments.filter((segment) => !selectedCaveId.value || segment.caveId === selectedCaveId.value)
)
const currentSegment = computed(() => segmentState.segments.find((segment) => segment.id === selectedSegmentId.value))

const segmentAllStations = computed(() =>
  stationState.stations
    .filter((station) => station.segmentId === selectedSegmentId.value)
    .sort((a, b) => Number((a.code.match(/\d+/) ?? ['0'])[0]) - Number((b.code.match(/\d+/) ?? ['0'])[0]))
)

/** 当前洞段的批次列表（按时间升序，末位为最近一次批次） */
const batchOptions = computed(() => listBatches(segmentAllStations.value))
const newestBatchLabel = computed(() => batchOptions.value[batchOptions.value.length - 1]?.label ?? '')
const isNewBatch = computed(() => selectedBatch.value === NEW_BATCH)

/** 实际生效的批次标签：新建批次时取输入的批次名，缺省回落到测量日期 */
const activeBatchLabel = computed(() =>
  isNewBatch.value ? newBatchLabel.value.trim() || form.date || '未分批次' : selectedBatch.value
)

/** 当前批次的测点：闭合差、桩号序号与读数表只统计这一部分，历史批次不参与 */
const batchStations = computed(() => stationsOfBatch(segmentAllStations.value, activeBatchLabel.value))

/** 已保存测点 + 当前待录入测点一起参与闭合差计算，实时反映累计闭合差 */
const pendingStation = computed<Station>(() => ({
  id: 'pending',
  segmentId: selectedSegmentId.value,
  code: form.code,
  bearing: form.bearing,
  dip: form.dip,
  slopeDistance: form.slopeDistance,
  horizontalDistance: previewHorizontal.value,
  verticalDistance: previewVertical.value,
  instrumentNo: form.instrumentNo,
  surveyor: form.surveyor,
  date: form.date,
  batch: activeBatchLabel.value,
  isClosurePoint: form.isClosurePoint,
  note: form.note
}))

/** 闭合差只累计当前批次：已保存的当前批次测点 + 待录入测点 */
const closureInput = computed<Station[]>(() => [...batchStations.value, pendingStation.value])
const { result: closureResult, over: closureOver } = useClosureCheck(closureInput)

const previewHorizontal = computed(() => computeHorizontal(form.dip, form.slopeDistance))
const previewVertical = computed(() => computeVertical(form.dip, form.slopeDistance))

/** 异常读数：方位角或倾角超范围、斜距非正、水平距大于斜距 */
function isAbnormal(station: Station): boolean {
  if (!isValidBearing(station.bearing)) return true
  if (!isValidDip(station.dip)) return true
  if (!(station.slopeDistance > 0)) return true
  return station.horizontalDistance > Math.abs(station.slopeDistance) + 0.001
}

function rowClassName(param: { row: Station }): string {
  return isAbnormal(param.row) ? 'abnormal-row' : ''
}

function refreshDefaultCode(): void {
  if (editingId.value) return
  form.code = nextCode('P', batchStations.value.map((station) => station.code))
}

// IndexedDB 数据是异步水合的，洞穴/洞段到达后自动选中第一条，避免空选
watch(
  () => [caveState.caves.length, selectedCaveId.value] as const,
  () => {
    if (!selectedCaveId.value && caveState.caves.length > 0) {
      selectedCaveId.value = caveState.caves[0].id
    }
  },
  { immediate: true }
)

watch(
  () => [selectedCaveId.value, segmentOptions.value.length] as const,
  () => {
    const list = segmentOptions.value
    if (!list.some((segment) => segment.id === selectedSegmentId.value)) {
      selectedSegmentId.value = list.length > 0 ? list[0].id : ''
    }
  },
  { immediate: true }
)

// 切换洞段：重置编辑态，默认沿用该洞段最近一次批次
watch(
  () => selectedSegmentId.value,
  () => {
    editingId.value = null
    keepNewBatch.value = false
    if (batchOptions.value.length === 0) {
      selectedBatch.value = NEW_BATCH
      newBatchLabel.value = form.date
    } else {
      selectedBatch.value = newestBatchLabel.value
    }
    refreshDefaultCode()
  },
  { immediate: true }
)

// 批次列表变化（水合完成、当前批次最后一条测点被移除等）：回落到最近一批
watch(
  () => batchOptions.value.map((batch) => batch.label).join('|'),
  () => {
    if (selectedBatch.value === NEW_BATCH && keepNewBatch.value) return
    if (batchOptions.value.length === 0) {
      selectedBatch.value = NEW_BATCH
      newBatchLabel.value = form.date
    } else if (!batchOptions.value.some((batch) => batch.label === selectedBatch.value)) {
      selectedBatch.value = newestBatchLabel.value
    }
    refreshDefaultCode()
  }
)

/** 切换批次选择：手动选「新建批次」时预填批次名，并保持不被自动回落覆盖 */
function onBatchChange(value: string): void {
  keepNewBatch.value = value === NEW_BATCH
  if (value === NEW_BATCH) {
    newBatchLabel.value = form.date
  }
  editingId.value = null
  refreshDefaultCode()
}

async function submit(continueNext: boolean): Promise<void> {
  if (!selectedSegmentId.value) {
    ElMessage.warning('请先选择洞段')
    return
  }
  if (!form.code.trim()) {
    ElMessage.warning('请填写测点桩号')
    return
  }
  if (!(form.slopeDistance > 0)) {
    ElMessage.warning('斜距必须大于 0')
    return
  }
  if (!isValidBearing(form.bearing)) {
    ElMessage.warning('前视方位角必须在 0°–360° 之间')
    return
  }
  if (!isValidDip(form.dip)) {
    ElMessage.warning('倾角必须在 -90°–90° 之间')
    return
  }
  if (isNewBatch.value && !newBatchLabel.value.trim() && !form.date) {
    ElMessage.warning('请填写新批次名称或测量日期')
    return
  }
  const existing = stationState.stations.find((station) => station.id === editingId.value)
  const station: Station = {
    id: existing?.id ?? uid('st'),
    segmentId: selectedSegmentId.value,
    code: form.code.trim(),
    bearing: form.bearing,
    dip: form.dip,
    slopeDistance: form.slopeDistance,
    horizontalDistance: previewHorizontal.value,
    verticalDistance: previewVertical.value,
    instrumentNo: form.instrumentNo.trim(),
    surveyor: form.surveyor.trim(),
    date: form.date,
    batch: activeBatchLabel.value,
    isClosurePoint: form.isClosurePoint,
    note: form.note.trim()
  }
  await stationStore.getState().save(station)
  // 保存后沿用本次批次（新批次落库后即转为已有批次）
  keepNewBatch.value = false
  selectedBatch.value = station.batch
  lastSaved.value = `${station.code} · 批次「${station.batch}」 · 水平距 ${station.horizontalDistance} m / 垂距 ${station.verticalDistance} m`
  ElMessage.success(existing ? `测点 ${station.code} 已更新` : `测点 ${station.code} 已录入`)
  editingId.value = null
  form.isClosurePoint = false
  form.note = ''
  if (continueNext) {
    refreshDefaultCode()
  }
}

function editStation(station: Station): void {
  editingId.value = station.id
  // 批次上下文跟随被编辑的测点，历史批次读数可回看修正
  keepNewBatch.value = false
  selectedBatch.value = stationBatch(station)
  form.code = station.code
  form.bearing = station.bearing
  form.dip = station.dip
  form.slopeDistance = station.slopeDistance
  form.instrumentNo = station.instrumentNo
  form.surveyor = station.surveyor
  form.date = station.date
  form.isClosurePoint = station.isClosurePoint
  form.note = station.note
}

async function removeStation(station: Station): Promise<void> {
  await ElMessageBox.confirm(`确认删除测点「${station.code}」？`, '删除确认', { type: 'warning' })
  await stationStore.getState().remove(station.id)
  ElMessage.success('测点已删除')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">测点与读数录入</h2>
        <p class="page-sub">
          按测量批次录入前视方位角、倾角与斜距，系统自动推算水平距与垂距；闭合差与桩号序号只统计当前批次，历史批次可切换查看、不参与当前结果。
        </p>
      </div>
      <el-tag v-if="lastSaved" type="success" effect="plain">最近保存：{{ lastSaved }}</el-tag>
    </div>

    <div class="toolbar">
      <el-select v-model="selectedCaveId" placeholder="选择洞穴" style="width: 200px">
        <el-option v-for="cave in cavesWithSegments" :key="cave.id" :label="cave.name" :value="cave.id" />
      </el-select>
      <el-select v-model="selectedSegmentId" placeholder="选择洞段" style="width: 220px">
        <el-option
          v-for="segment in segmentOptions"
          :key="segment.id"
          :label="`${segment.code}（${segment.startStake} → ${segment.endStake}）`"
          :value="segment.id"
        />
      </el-select>
      <SegmentTag v-if="currentSegment" :type="currentSegment.type" :closed="currentSegment.closed" size="small" />
      <el-select v-model="selectedBatch" placeholder="选择测量批次" style="width: 210px" @change="onBatchChange">
        <el-option
          v-for="batch in batchOptions"
          :key="batch.label"
          :label="`${batch.label}${batch.label === newestBatchLabel ? '（最新）' : ''} · ${batch.count} 站`"
          :value="batch.label"
        />
        <el-option label="＋ 新建批次" :value="NEW_BATCH" />
      </el-select>
      <el-input
        v-if="isNewBatch"
        v-model="newBatchLabel"
        placeholder="新批次名称，默认取测量日期"
        style="width: 190px"
      />
      <el-button :disabled="!selectedSegmentId" @click="refreshDefaultCode">重算下一桩号</el-button>
    </div>

    <el-card shadow="never" class="form-card">
      <el-form label-width="96px">
        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item label="测点桩号" required>
              <el-input v-model="form.code" placeholder="如 P12" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="前视方位角">
              <BearingInput v-model="form.bearing" kind="bearing" @invalid="(msg: string) => ElMessage.warning(msg)" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="倾角">
              <BearingInput v-model="form.dip" kind="dip" @invalid="(msg: string) => ElMessage.warning(msg)" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="斜距(m)" required>
              <el-input-number v-model="form.slopeDistance" :min="0" :step="0.1" :precision="3" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item label="仪器号">
              <el-input v-model="form.instrumentNo" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="测量人">
              <el-input v-model="form.surveyor" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="测量日期">
              <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="闭合点">
              <el-switch v-model="form.isClosurePoint" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" placeholder="岩壁、滴水、崩塌堆积等现场情况" />
        </el-form-item>
        <div class="preview">
          <el-tag effect="plain">自动推算：水平距 {{ previewHorizontal.toFixed(3) }} m</el-tag>
          <el-tag effect="plain">垂距 {{ previewVertical.toFixed(3) }} m</el-tag>
          <el-tag effect="plain">方位角 {{ formatDms(form.bearing) }}</el-tag>
          <el-tag effect="plain">倾角 {{ formatDms(form.dip) }}</el-tag>
        </div>
        <div class="actions">
          <el-button type="primary" @click="submit(false)">{{ editingId ? '保存修改' : '保存测点' }}</el-button>
          <el-button type="success" plain @click="submit(true)">保存并录入下一站</el-button>
          <el-button v-if="editingId" @click="editingId = null">取消编辑</el-button>
        </div>
      </el-form>
    </el-card>

    <ClosureBadge
      class="closure"
      :closure="closureResult.closure"
      :threshold="closureResult.threshold"
      :level="closureResult.level"
      :detail="closureResult.detail"
      :count="batchStations.length"
    />
    <el-alert
      v-if="closureOver"
      class="alert"
      type="error"
      :closable="false"
      title="闭合差已超限"
      description="当前批次累计闭合差超过阈值，建议复测异常测点或对读数做误差分配。"
    />

    <h3 class="section-title">本批次读数（批次「{{ activeBatchLabel }}」 · {{ batchStations.length }} 站）</h3>
    <el-table :data="batchStations" border stripe :row-class-name="rowClassName">
      <el-table-column prop="code" label="桩号" width="90" />
      <el-table-column label="方位角" width="150">
        <template #default="{ row }: { row: Station }">{{ row.bearing }}° / {{ formatDms(row.bearing) }}</template>
      </el-table-column>
      <el-table-column label="倾角" width="140">
        <template #default="{ row }: { row: Station }">{{ row.dip }}°</template>
      </el-table-column>
      <el-table-column prop="slopeDistance" label="斜距(m)" width="100" />
      <el-table-column prop="horizontalDistance" label="水平距(m)" width="110" />
      <el-table-column prop="verticalDistance" label="垂距(m)" width="100" />
      <el-table-column prop="instrumentNo" label="仪器号" width="110" />
      <el-table-column prop="surveyor" label="测量人" width="90" />
      <el-table-column prop="date" label="日期" width="120" />
      <el-table-column label="闭合点" width="90">
        <template #default="{ row }: { row: Station }">
          <el-tag v-if="row.isClosurePoint" type="success" size="small" effect="plain">是</el-tag>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="读数状态" width="110">
        <template #default="{ row }: { row: Station }">
          <el-tag v-if="isAbnormal(row)" type="danger" size="small" effect="dark">异常</el-tag>
          <el-tag v-else type="success" size="small" effect="plain">正常</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip />
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }: { row: Station }">
          <el-button link type="primary" size="small" @click="editStation(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="removeStation(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.form-card {
  border-radius: 12px;
  margin-bottom: 16px;
}
.preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 0 0 96px;
}
.actions {
  display: flex;
  gap: 10px;
  padding: 14px 0 0 96px;
}
.closure {
  margin-bottom: 12px;
}
.alert {
  margin-bottom: 12px;
}
:deep(.abnormal-row) {
  background: #fdf2f2 !important;
}
:deep(.abnormal-row td) {
  color: #b03030;
}
</style>
