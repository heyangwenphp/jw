<template>
  <div class="report-welcome">
    <div class="welcome-hints">
      <button
        v-for="report in reports"
        :key="report.id"
        type="button"
        class="report-card"
        :title="report.name"
        @click="handleSelectMode(report)"
      >
        <span class="report-card-image-shell">
          <img class="report-card-image" :src="report.image" :alt="report.name" />
        </span>
        <span class="report-card-body">
          <span class="report-card-title">{{ report.name }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  reports: {
    type: Array,
    default: () => []
  },
  activeFilePath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['select-mode'])

const handleSelectMode = report => {
  emit('select-mode', report)
}
</script>

<style scoped>
.report-welcome {
  width: min(1180px, 100%);
  margin: 0 auto;
}

.welcome-hints {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  width: 100%;
}

.report-card {
  min-width: 0;
  min-height: 238px;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-color-secondary);
  color: var(--text-color);
  overflow: hidden;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  text-align: left;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.report-card:hover,
.report-card:focus-visible {
  transform: translateY(-2px);
  border-color: var(--primary-color);
  box-shadow: 0 16px 30px rgba(15, 23, 42, 0.14);
  outline: none;
}

.report-card-image-shell {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--bg-color-tertiary);
  overflow: hidden;
  flex-shrink: 0;
}

.report-card-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.report-card-body {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  min-height: 0;
  flex: 1 1 auto;
}

.report-card-title {
  font-size: 18px;
  line-height: 1.3;
  color: var(--text-color);
  font-weight: 700;
  text-align: center;
}

@media (max-width: 980px) {
  .welcome-hints {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .welcome-hints {
    grid-template-columns: 1fr;
  }

  .report-card {
    min-height: 0;
  }
}
</style>
