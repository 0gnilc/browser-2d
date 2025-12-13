<template>
  <div class="container">
    <div class="tools">
      <el-button size="small" :icon="Plus" type="success" @click="onImportMaterial">导入物料</el-button>
      <el-button size="small" :icon="Delete" type="danger" @click="onClearMaterial">清空物料</el-button>
      <el-button size="small" :icon="Plus" type="info" @click="onAddDevice">添加设备</el-button>
      <el-button size="small" :icon="Refresh" type="danger" @click="onStartAll">全部启动/重启</el-button>
      <el-button size="small" :icon="Switch" type="warning" @click="onStopAll">全部停止</el-button>
      <el-button size="small" :icon="Refresh" type="primary" @click="onOpenDrawer">搜索</el-button>
      <el-button size="small" :icon="List" @click="onToHistory">历史数据</el-button>
      <el-button size="small" :icon="Setting" @click="onToSetting">系统设置</el-button>
      <el-button size="small" :icon="Refresh" @click="onRefresh">刷新</el-button>
    </div>
    <div>
      <el-drawer v-model="drawer" title="搜索" direction="rtl">
        <el-form :inline="true" :model="params" class="search-form">
          <el-form-item label="卡号：" prop="card">
            <el-input v-model="params.card" placeholder="请输入卡号" clearable style="width: 250px;" />
          </el-form-item>
          <el-form-item label="状态：" prop="status" style="width: 80%;">
            <el-select v-model="params.status" placeholder="请选择状态" clearable>
              <el-option label="待处理" value="0" />
              <el-option label="处理中" value="1" />
              <el-option label="成功" value="2" />
              <el-option label="失败" value="3" />
              <el-option label="3D验证" value="4" />
              <el-option label="余额不足" value="5" />
              <el-option label="其他" value="6" />
            </el-select>
          </el-form-item>
          <el-form-item class="form-footer">
            <el-button type="primary" :icon="Refresh" @click="onQueryMaterials">
              搜索
            </el-button>
            <el-button :icon="Refresh" @click="onClearQuery">
              清空
            </el-button>
          </el-form-item>
        </el-form>
      </el-drawer>
    </div>
    <div class="material">
      <el-table :data="materials" height="100%" fit :border="true" size="small" stripe empty-text="暂无数据">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="card" label="卡号" width="210" />
        <el-table-column prop="year" label="年" width="60" />
        <el-table-column prop="month" label="月" width="60" />
        <el-table-column prop="day" label="日" width="60" />
        <el-table-column prop="cvv" label="cvv" width="80" />
        <el-table-column prop="amount" label="成功金额" width="100" />
        <el-table-column prop="device" label="设备" width="150" />
        <el-table-column prop="status" label="状态" width="80">
          <template #default="scope">
            <span style="color: var(--el-color-info);" v-if="scope.row.status == 0">待处理</span>
            <span style="color: var(--el-color-primary);" v-else-if="scope.row.status == 1">处理中</span>
            <span style="color: var(--el-color-success);" v-else-if="scope.row.status == 2">成功</span>
            <span style="color: var(--el-color-danger);" v-else-if="scope.row.status == 3">失败</span>
            <span style="color: var(--el-color-warning);" v-else-if="scope.row.status == 4">3D验证</span>
            <span style="color: var(--el-color-warning);" v-else-if="scope.row.status == 5">余额不足</span>
            <span v-else-if="scope.row.status == 6">其他</span>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="说明" width="150" show-overflow-tooltip/>
        <el-table-column prop="actions" label="操作">
          <template #default="scope">
            <el-button @click="onDeleteMaterial(scope.row)" size="small" :icon="Delete" type="danger">删除</el-button>
            <el-button @click="onResetMaterial(scope.row)" size="small" :icon="Refresh" type="warning">重置</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div style="margin-top: 5px;">
      <el-pagination size="small" v-model:current-page="pagination.page" v-model:page-size="pagination.pageSize"
        layout="prev, pager, next, total, sizes" :total="pagination.total" @current-change="onPageMaterials"
        @size-change="onPageMaterials">
      </el-pagination>
    </div>
    <div class="device">
      <el-table :data="devices" height="100%" fit :border="true" size="small" stripe empty-text="暂无数据">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="symbol" label="设备标识" width="180" />
        <el-table-column prop="status" label="工作状态" width="80">
          <template #default="scope">
            <el-tag v-if="scope.row.status == 1" type="success">运行中</el-tag>
            <el-tag v-else-if="scope.row.status == 2" type="warning">已停止</el-tag>
            <el-tag v-else-if="scope.row.status == 3" type="danger">异常</el-tag>
            <el-tag v-else type="info">未知</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="account" label="账户" width="150" />
        <el-table-column prop="amount" label="金额" width="100" />
        <el-table-column prop="count" label="工作次数" width="100" />
        <el-table-column prop="actions" label="操作">
          <template #default="scope">
            <el-switch v-model="scope.row.switch" @change="onToggleDevice(scope.row)"
              style="--el-switch-on-color: #13ce66; --el-switch-off-color: #ff4949" />
            <el-button @click="onUpdateDevice(scope.row)" style="margin-left: 10px;" size="small" :icon="Edit"
              type="primary" />
            <el-button @click="onDeleteDevice(scope.row)" style="margin-left: 10px;" size="small" :icon="Delete"
              type="danger" />
          </template>
        </el-table-column>
      </el-table>
    </div>
    <DeviceFrom ref="dfr" />
    <MaterialFrom ref="mfr" />
  </div>
</template>

<script setup>
import { ref, onMounted, reactive } from 'vue'
import _ from 'lodash'
import { Plus, Edit, Delete, Refresh, SwitchButton as Switch, List, Setting } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import DeviceFrom from './components/DeviceFrom.vue'
import MaterialFrom from './components/MaterialFrom.vue'
import { convert } from '@/utils/convert'
import { Toast, MessageBox } from '@/utils/message'

const ele = window.ele

const router = useRouter()
const dfr = ref(null)
const mfr = ref(null)
const drawer = ref(false)

const params = reactive({
  card: '',
  status: '',
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 1000,
})

const materials = ref([])
const devices = ref([])

const onClearQuery = () => {
  params.card = ''
  params.status = ''
  onQueryMaterials()
}

const onImportMaterial = () => {
  mfr.value.open('', {
    title: '导入物料',
    confirm: (data, done) => {
      const list = convert(data);
      if (list.length === 0) {
        Toast.error('导入物料格式错误或者为空')
        return
      }
      for (let index = 0; index < list.length; index++) {
        const item = list[index];
        ele.material.create(item).then((res) => {
          if (!res.success) {
            Toast.error(`导入失败：${res.error}`)
          }
          if (index == list.length - 1) {
            Toast.success(`导入完成：${list.length}条`)
            done()
            onRefresh()
          }
        })
      }
    }
  })
}

const onClearMaterial = () => {
  MessageBox.confirm('确定清空所有物料吗？').then(() => {
    ele.material.clear().then((res) => {
      if (res.success) {
        Toast.success('清空成功')
        onRefresh()
      } else {
        Toast.error('清空错误:' + res.error)
      }
    })
  }).catch(() => { })
}

const onDeleteMaterial = (material) => {
  MessageBox.confirm('确定删除吗？').then(() => {
    ele.material.delete(material.id).then((res) => {
      if (res.success) {
        Toast.success('删除成功')
        onQueryMaterials()
      } else {
        Toast.error('删除错误:' + res.error)
      }
    })
  }).catch(() => { })
}

const onResetMaterial = (material) => {
  ele.material.reset(material.id).then((res) => {
    if (res.success) {
      Toast.success('重置成功')
      onPageMaterials()
    } else {
      Toast.error('重置错误:' + res.error)
    }
  }).catch((err) => {
    Toast.error('重置错误:' + err.message)
  })
}

const onQueryMaterials = () => {
  pagination.page = 1
  onPageMaterials()
}

const onPageMaterials = () => {
  ele.material.page({ ...params, page: pagination.page, pageSize: pagination.pageSize })
    .then((res) => {
      if (res.success) {
        const data = res.data
        pagination.total = data.total
        pagination.page = data.page
        pagination.pageSize = data.pageSize
        materials.value = data.list
      } else {
        Toast.error('获取错误:' + res.error)
      }
    })
}

const onAddDevice = () => {
  dfr.value.open({}, {
    title: '添加设备',
    confirm: (device, done) => {
      const data = _.cloneDeep(device);
      ele.device.create(data)
        .then((res) => {
          if (res.success) {
            done()
            Toast.success('添加设备成功')
            onQueryDevices()
          } else {
            Toast.error('添加设备错误:' + res.error)
          }
        })
    }
  })
}

const onUpdateDevice = (_device) => {
  dfr.value.open(_.cloneDeep(_device), {
    title: '编辑设备',
    confirm: (device, done) => {
      ele.device.update(device.id, _.cloneDeep(device))
        .then((res) => {
          if (res.success) {
            done()
            Toast.success('编辑设备成功')
            onQueryDevices()
          } else {
            Toast.error('编辑设备错误:' + res.error)
          }
        })
    }
  })
}

const onDeleteDevice = (device) => {
  MessageBox.confirm('确定删除该设备吗？').then(() => {
    ele.device.delete(device.id).then((res) => {
      if (res.success) {
        Toast.success('删除设备成功')
        onQueryDevices()
      } else {
        Toast.error('删除设备错误:' + res.error)
      }
    })
  }).catch(() => { })
}

const onQueryDevices = () => {
  ele.device.list().then((res) => {
    if (res.success) {
      devices.value = res.data.map(item => ({
        ...item,
        switch: item.status == 1 ? true : false
      }))
    } else {
      Toast.error('获取设备错误:' + res.error)
    }
  })
}

const onToggleDevice = (device) => {
  if (!device.switch) {
    ele.work.stop(device.id).then(() => {
      onQueryDevices()
      Toast.success('停止设备成功')
    }).catch((err) => {
      console.error(err);
      Toast.error('停止设备错误:' + err.message)
      device.switch = !device.switch
    })
  } else {
    ele.work.start(device.id).then(() => {
      onQueryDevices()
      Toast.success('启动设备成功')
    }).catch((err) => {
      console.error(err);
      Toast.error('启动设备错误:' + err.message)
      device.switch = !device.switch
    })
  }
}

const onStartAll = () => {
  ele.work.startAll().then(() => {
    onQueryDevices()
    Toast.success('全部启动成功')
  }).catch((err) => {
    Toast.error('全部启动错误:' + err.message)
  })
}

const onStopAll = () => {
  ele.work.stopAll().then(() => {
    onQueryDevices()
    Toast.success('全部停止成功')
  }).catch((err) => {
    Toast.error('全部停止错误:' + err.message)
  })
}

const onOpenDrawer = () => {
  drawer.value = true
}

const onRefresh = () => {
  onQueryDevices()
  onPageMaterials()
}

const onToHistory = () => {
  router.push({ name: 'history' })
}

const onToSetting = () => {
  router.push({ name: 'setting' })
}

onMounted(() => {
  onRefresh()

  ele.device.onReload(() => {
    onQueryDevices()
  })

  ele.material.onReload(() => {
    onPageMaterials()
  })
})

</script>

<style scoped>
.container {
  padding: 10px 20px;
  display: flex;
  flex-direction: column;
}

.tools {
  margin-bottom: 20px;
}

.material {
  height: 55vh;
  overflow: auto;
}

.device {
  margin-top: 10px;
  height: 30vh;
  overflow: auto;
}

.form-footer {
  margin-top: 20px;
}
</style>