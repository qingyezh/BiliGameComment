<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import { createChart } from "../web/charts.js";

const props = defineProps({
  payload: { type: Object, default: null },
  showMean: { type: Boolean, default: true },
  height: { type: Number, default: 400 },
});

const canvasRef = ref(null);
const legendRef = ref(null);
let chart = null;

function ensure() {
  if (!chart && canvasRef.value) {
    chart = createChart(canvasRef.value, legendRef.value);
  }
  return chart;
}

function apply() {
  const c = ensure();
  if (!c || !props.payload) return;
  c.update(props.payload);
  c.setShowMean(props.showMean);
}

onMounted(async () => {
  await nextTick();
  apply();
  requestAnimationFrame(() => chart?.redraw());
});

watch(() => props.payload, () => apply(), { deep: true });
watch(() => props.showMean, (v) => chart?.setShowMean(v));

onBeforeUnmount(() => {
  chart = null;
});

defineExpose({
  redraw: () => chart?.redraw(),
  toPng: () => canvasRef.value?.toDataURL("image/png"),
});
</script>

<template>
  <div class="chart-host" :style="{ height: height + 'px' }">
    <canvas ref="canvasRef"></canvas>
    <div ref="legendRef" class="chart-legend"></div>
  </div>
</template>

<style scoped>
.chart-host {
  position: relative;
  width: 100%;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}
.chart-host canvas {
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
  display: block;
}
.chart-legend {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 8px;
  max-height: 72px;
  overflow: auto;
}
.chart-legend :deep(.legend-item) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #e5eaf2;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  background: #fff;
  cursor: pointer;
}
.chart-legend :deep(.legend-item i) {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.chart-legend :deep(.legend-item.off) {
  opacity: 0.4;
}
</style>
