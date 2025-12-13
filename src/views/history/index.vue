<template>
    <div class="container">
        <div class="tools">
            <el-button size="small" :icon="Menu" @click="onToIndex">返回首页</el-button>
            <el-button size="small" :icon="Delete" type="danger" @click="onClear">清空数据</el-button>
            <el-button size="small" :icon="Download" type="success" @click="onExport">导出数据</el-button>
        </div>
        <el-form :inline="true" :model="params">
            <el-form-item label="卡号：" prop="card">
                <el-input v-model="params.card" placeholder="请输入卡号" clearable style="width: 250px;" />
            </el-form-item>
            <el-form-item label="状态：" prop="status" style="width: 180px;">
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
            <el-form-item label="创建时间：" prop="card">
                <el-date-picker v-model="params.createTime" type="datetimerange" value-format="YYYY-MM-DD HH:mm:ss"
                    range-separator="到" start-placeholder="开始时间" end-placeholder="结束时间" />
            </el-form-item>
            <el-form-item>
                <el-button type="primary" :icon="Refresh" @click="onQuery">
                    搜索
                </el-button>
                <el-button :icon="Refresh" @click="onReset">
                    重置
                </el-button>
            </el-form-item>
        </el-form>
        <el-table :data="historys" height="76vh" fit :border="true" size="small" stripe empty-text="暂无数据">
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
            <el-table-column prop="note" label="说明" width="150" show-overflow-tooltip />
            <el-table-column prop="createTime" label="创建时间" width="150" />
            <el-table-column prop="actions" label="操作">
                <template #default="scope">
                    <el-button size="small" :icon="Delete" type="danger"
                        @click="onDeleteMaterial(scope.row)">删除</el-button>
                    <el-button size="small" :icon="Refresh" type="warning">重置</el-button>
                </template>
            </el-table-column>
        </el-table>
        <el-pagination style="margin-top: 5px;" v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize" layout="prev, pager, next, sizes" :total="pagination.total"
            @current-change="onPage" @size-change="onPage">
        </el-pagination>
    </div>
</template>

<script setup>
import _ from 'lodash'
import { ref, reactive, onMounted } from 'vue'
import { Delete, Refresh, Menu, Download } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { Toast } from '@/utils/message'

const ele = window.ele
const router = useRouter()
const historys = ref([])

const params = reactive({
    card: '',
    status: '',
    createTime: []
})

const pagination = reactive({
    page: 1,
    pageSize: 20,
    total: 999,
})

const onPage = () => {
    const argrs = _.cloneDeep({ ...params, ...pagination })
    ele.history.page(argrs).then((res) => {
        if (res.success) {
            const data = res.data
            pagination.total = data.total
            pagination.page = data.page
            pagination.pageSize = data.pageSize
            historys.value = data.list
        } else {
            Toast.error('获取物料错误:' + res.error)
        }
    })
}

const onQuery = () => {
    pagination.page = 1
    onPage()
}

const onReset = () => {
    params.card = ''
    params.status = ''
    params.createTime = []
    onQuery()
}

const onClear = () => {
    ele.history.clear().then((res) => {
        if (res.success) {
            Toast.success('清空数据成功')
            onQuery()
        }
    })
}

const onToIndex = () => {
    router.push({ name: 'index' })
}

const onExport = () => {
    ele.history.list(_.cloneDeep(params)).then((res) => {
        if (!res.success) {
            Toast.error('获取数据错误:' + res.error)
            return
        }
        const list = res.data
        if (!_.isArray(list) || _.isEmpty(list)) {
            Toast.error('暂无数据')
            return
        }
        const data = list.map(item => {
            const { card, month, day, cvv } = item
            return `${card}|${month}|${day}|${cvv}`
        }).reduce((acc, curr) => (acc + curr + '\n'), '')
        const blob = new Blob([data], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'history.txt'
        a.click()
        URL.revokeObjectURL(url)
    })
}

onMounted(() => {
    onPage()
})
</script>

<style scoped>
.container {
    padding: 10px 20px 0;
}

.tools {
    margin-bottom: 20px;
}
</style>