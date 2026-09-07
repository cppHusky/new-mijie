import { ref } from 'vue'

function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
        str += '=';
    }
    return decodeURIComponent(atob(str).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
}

class User {
    constructor() {
        this.update()
    }
    update() {
        const token = localStorage.getItem("token")
        if (token) {
            try {
                // JWT 仅含 { sub, admin }，不再内嵌进度
                const payload = JSON.parse(base64UrlDecode(token.split('.')[1]))
                this.set('login', true)
                this.set('username', payload.sub)
                this.set('admin', payload.admin || 0)
                this.set('gameStarted', true)
                this.set('gameStartTime', '')
            } catch (err) {
                console.error(err)
                this.set('login', false)
                this.set('username', '')
                this.set('admin', 0)
            }
            // 进度摘要（通关数/总分/QQ/游戏状态）以 /api/me 为准
            fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } })
                .then(res => res.ok ? res.json() : Promise.reject(res))
                .then(me => {
                    this.set('qq', me.qq || '')
                    this.set('totalPoints', me.totalPoints)
                    this.set('passedCount', me.passedCount)
                    this.set('gameStarted', !!me.started)
                    this.set('gameStartTime', me.startTime || '')
                })
                .catch(() => { })
        } else {
            this.set('login', false)
            this.set('username', '')
            this.set('admin', 0)
            this.set('qq', '')
            this.set('totalPoints', 0)
            this.set('passedCount', 0)
            this.set('gameStarted', true)
            this.set('gameStartTime', '')
        }
    }
    set(key, value) {
        if (this[key]) this[key].value = value
        else this[key] = ref(value)
    }
}

export const noticeEventListener = new EventTarget();

export const rankEventListener = new EventTarget();

export const user = new User()

/** 重新拉取 /api/me 刷新游戏状态（供路由守卫/首页获取最新开局状态） */
export async function refreshGameStatus() {
    const token = localStorage.getItem('token')
    if (!token) return { started: true, startTime: '' }
    try {
        const res = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } })
        if (!res.ok) return { started: user.gameStarted?.value ?? true, startTime: user.gameStartTime?.value ?? '' }
        const me = await res.json()
        user.set('gameStarted', !!me.started)
        user.set('gameStartTime', me.startTime || '')
        return { started: !!me.started, startTime: me.startTime || '' }
    } catch {
        return { started: user.gameStarted?.value ?? true, startTime: user.gameStartTime?.value ?? '' }
    }
}
