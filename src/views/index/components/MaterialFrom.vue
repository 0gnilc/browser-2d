<template>
    <el-dialog v-model="visible" :title="options.title" width="70%" center draggable>
        <template #default>
            <el-input v-model="data" type="textarea" :autosize="{ minRows: 10, maxRows: 20 }"
            placeholder="请输入数据" />
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

const data = ref({})
const options = ref({})
const visible = ref(false)

const onCancel = () => {
    visible.value = false
}

const onConfirm = () => {
    if (options.value?.confirm) {
        options.value.confirm(data.value, () => {
            visible.value = false
        })
    } else {
        visible.value = false
    }
}

const open = (_data = '', _options = {}) => {
    data.value = _data
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