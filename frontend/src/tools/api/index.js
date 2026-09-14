import notificationManager from '@/tools/notification.js'
import { user } from '@/tools/bus.js'
import { useRouter } from 'vue-router'  

export function apiMethod(method, url, body) {
  const headers = {
    'Content-Type': 'application/json',
  }
  const router = useRouter()
  if (localStorage.getItem('token')) headers['Authorization'] = 'Bearer ' + localStorage.getItem('token');
  return new Promise((resolve, reject) => {
    fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    })
      .then(async res => {
        if (res.status == 200) return res.json()
        const text = await res.text()
        let data = null
        try { data = JSON.parse(text) } catch { }
        const message = data?.error || text
        if (res.status == 401 && data?.action == 'logout') {
          // 会话失效：清理本地登录态（user.login 立即变 false），
          // 之后各页面的 401 跳转逻辑会正常进入登录页
          const hadToken = !!localStorage.getItem('token')
          localStorage.removeItem('token')
          user.update()
          if (hadToken) {
            notificationManager.add({
              message,
              type: 'error',
              time: 5000,
            })
          }
          reject(res)
          return
        }
        notificationManager.add({
          message,
          type: 'error',
          time: 5000,
        })
        reject(res)
      }).then(res => {
        
        if (res?.token && res?.token?.length) {
          localStorage.setItem("token", res.token)
          user.update()
        }
        if (res?.message && res?.message?.length) {
          notificationManager.add({
            message: res.message,
            type: 'success',
            time: 2000,
          })
        }
        if (res?.error && res?.error?.length) {
          notificationManager.add({
            message: res.error,
            type: 'error',
            time: 5000,
          })
        }
        if (res?.action && res?.action == 'logout') {
          localStorage.removeItem('token')
          user.update()
          router.push('/login')
          reject({status:0})
        }
        resolve(res)
      }).catch(err => {
        notificationManager.add({
          message: err.message,
          type: 'error'
        })
        reject(err)
      })
  })
}

export function api(url, body) {
  return apiMethod(body ? 'POST' : 'GET', url, body)
}

export function apiPut(url, body) {
  return apiMethod('PUT', url, body)
}

export function apiDelete(url, body) {
  return apiMethod('DELETE', url, body)
}

export async function downloadFile(fileUrl, fileName) {
  try {
    const headers = {}
    if (localStorage.getItem('token')) headers['Authorization'] = 'Bearer ' + localStorage.getItem('token');
    const response = await fetch(fileUrl, { method: 'GET', headers: headers });
    if (!response.ok) {
      const text = await response.text()
      let message = text
      try { message = JSON.parse(text)?.error || text } catch { }
      notificationManager.add({
        message,
        type: 'error',
        time: 5000,
      })
      return
    }
    const blob = await response.blob();
    const a = document.createElement('a');
    a.style.display = 'none';
    document.body.appendChild(a);
    const url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    notificationManager.add({
      message: error.message,
      type: 'error'
    })
  }
}
