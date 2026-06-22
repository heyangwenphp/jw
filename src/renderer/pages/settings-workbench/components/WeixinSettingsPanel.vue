<template>
  <div class="weixin-settings-panel">
    <WeixinNotifyWorkbenchTab />
  </div>
</template>

<script setup>
import WeixinNotifyWorkbenchTab from './WeixinNotifyWorkbenchTab.vue'
</script>

<style scoped>
.weixin-settings-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  overflow: auto;
}
</style>