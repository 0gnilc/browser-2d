// import { ElMessage, ElMessageBox } from 'element-plus'

export function message(type, text, duration = 1000, placement = 'top-right') {
    ElMessage({
        type,
        message: text,
        duration,
        showClose: true,
        placement,
    })
}

export const Toast = {
    success: (t) => message('success', t || 'Success!'),
    error: (t) => message('error', t || 'Error!'),
    warning: (t) => message('warning', t || 'Warning!'),
    info: (t) => message('info', t || 'Info'),
    primary: (t) => message('primary', t || 'Primary!'),
}

export const MessageBox = {
    confirm: (message, title = '提示', type = 'warning') => {
        return ElMessageBox.confirm(
            message,
            title,
            {
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type,
            }
        )
    }
}