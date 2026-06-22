<template>
  <div class="left-panel-header panel-shell-header">
    <div class="logo-wrap">
      <div class="brand-title" role="heading" aria-level="1">
        <span class="current-mode-text">舆情监控</span>
        <span class="app-version">v0.29</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.left-panel-header {
  padding: 12px 16px 8px;
}

.logo-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-title {
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  color: var(--text-color);
}

.current-mode-text {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-color);
  text-align: left;
}

.app-version {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--border-color-light);
  background: var(--bg-color-tertiary);
  color: var(--text-color-muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

</style>
