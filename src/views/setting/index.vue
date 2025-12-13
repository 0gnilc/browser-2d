<template>
  <div class="container">
    <div class="tools">
      <el-button size="small" :icon="Menu" @click="onToIndex">返回首页</el-button>
      <el-button size="small" :icon="Refresh" type="success" @click="onRefresh">刷新</el-button>
      <el-button size="small" :icon="Select" type="primary" @click="onSave" :loading="saving">保存</el-button>
    </div>
    <el-form :model="data" label-width="10em">
      <el-form-item label="AdsPower URL">
        <el-input v-model="data.adsPowerUrl" placeholder="请输入 AdsPower 服务地址" clearable />
      </el-form-item>
      <el-form-item label="AdsPower ApiKey">
        <el-input v-model="data.adsPowerApiKey" placeholder="请输入 AdsPower API Key" clearable />
      </el-form-item>
      <el-form-item label="浏览器窗口高度">
        <el-input v-model="data.viewportHeight" placeholder="请输入浏览器窗口高度" clearable />
      </el-form-item>
      <el-form-item label="浏览器窗口宽度">
        <el-input v-model="data.viewportWidth" placeholder="请输入浏览器窗口宽度" clearable />
      </el-form-item>
      <el-form-item label="窗口页面数">
        <el-input v-model="data.pageCount" placeholder="请输入窗口页面数" clearable />
      </el-form-item>
    </el-form>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import { Menu, Refresh, Select } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { Toast } from '@/utils/message'

const ele = window.ele;
const router = useRouter()

const data = ref({
  adsPowerUrl: '',
  adsPowerApiKey: '',
  viewportHeight: '',
  viewportWidth: '',
  pageCount: '',
})

const saving = ref(false)

const onToIndex = () => {
  router.push({ name: 'index' })
}

const onRefresh = async () => {
  try {
    const res = await ele.config.config()
    if (res.success) {
      data.value = res.data || {}
      Toast.success('刷新成功')
    } else {
      Toast.error('刷新失败：' + res.error)
    }
  } catch (error) {
    Toast.error('刷新失败：' + error.message)
  }
}

const onSave = async () => {
  saving.value = true
  try {
    const configs = {
      adsPowerUrl: data.value.adsPowerUrl || '',
      adsPowerApiKey: data.value.adsPowerApiKey || '',
      viewportHeight: data.value.viewportHeight || '',
      viewportWidth: data.value.viewportWidth || '',
      pageCount: data.value.pageCount || '',
    }
    const res = await ele.config.setMultiple(configs)
    if (res.success) {
      Toast.success('保存成功')
    } else {
      Toast.error('保存失败：' + res.error)
    }
  } catch (error) {
    Toast.error('保存失败：' + error.message)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  onRefresh()
})

</script>
<style scoped>
.container {
  padding: 10px 20px;
}

.tools {
  margin-bottom: 20px;
}
</style>