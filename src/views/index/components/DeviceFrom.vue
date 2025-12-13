<template>
    <el-dialog v-model="visible" :title="options.title" width="500" center draggable>
        <template #default>
            <el-form class="form" :model="device" label-width="5em">
                <el-form-item label="设备标识">
                    <el-input v-model="device.symbol" />
                </el-form-item>
                <el-form-item label="账户">
                    <el-input v-model="device.account" />
                </el-form-item>
                <el-form-item label="金额">
                    <el-input v-model="device.amount" />
                </el-form-item>
            </el-form>
        </template>
        <template #footer>
            <div class="dialog-footer">
                <el-button @click="onCancel">取消</el-button>
                <el-button type="primary" @click="onConfirm">确定</el-button>
            </div>
        </template>
    </el-dialog>
</template>

<script setup>
import { ref } from 'vue'

const device = ref({})
const options = ref({})
const visible = ref(false)

const onCancel = () => {
    visible.value = false
}

const onConfirm = () => {
    if(options.value?.confirm) {
        options.value.confirm(device.value, () => {
            visible.value = false
        })
    } else {
        visible.value = false
    }
}

const open = (_device = {}, _options = {}) => {
    device.value = _device
    options.value = _options
    visible.value = true
}

defineExpose({
    open
})
</script>
<style scoped>
.form {
    margin: 10px;
}
</style>