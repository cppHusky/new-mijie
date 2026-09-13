import { ref } from 'vue'

// 回顾模式（由 Worker 的 vars.REVIEW_MODE 决定，公开接口 /api/mode）
// 回顾模式差异：无比赛时间限制、无排行榜与通过率、可删除账号。
export const reviewMode = ref(false)

let loading = null

/** 拉取站点运行模式（进程内只请求一次；失败时按正常模式处理） */
export function loadMode() {
    if (!loading) {
        loading = fetch('/api/mode')
            .then(res => (res.ok ? res.json() : { review: false }))
            .then(mode => {
                reviewMode.value = !!mode.review
            })
            .catch(() => { })
    }
    return loading
}
