// 实时推送（替代 mijie 的 Ably）：原生 WebSocket 连接 DO 中枢，按频道分发。
// 回调签名与 mijie 保持一致：callback({ data })

let ws = null
const callbacks = new Map() // channel → Set<fn>

function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/api/realtime`)
    ws.onmessage = (e) => {
        try {
            const { channel, data } = JSON.parse(e.data)
            callbacks.get(channel)?.forEach(cb => cb({ data }))
        } catch { /* 忽略非 JSON 消息 */ }
    }
    ws.onclose = () => {
        ws = null
        setTimeout(connect, 3000)
    }
    ws.onerror = () => {
        try { ws.close() } catch { }
    }
}

export async function subscribe(channel, callback) {
    if (!callbacks.has(channel)) callbacks.set(channel, new Set())
    callbacks.get(channel).add(callback)
    console.log(`Subscribed to ${channel}`)
    connect()
}
