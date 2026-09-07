import * as VueRouter from 'vue-router'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'
import { user, refreshGameStatus } from '@/tools/bus'
import notificationManager from '@/tools/notification.js'
import { title } from '@/constants'

const router = VueRouter.createRouter({
    history: VueRouter.createWebHistory(),
    routes: [
        {
            path: '/',
            name: 'home',
            component: () => import('./pages/Home.vue'),
            meta: { title: '首页' }
        },
        {
            path: '/hint',
            name: 'hint',
            component: () => import('./pages/Hint.vue'),
            meta: { title: '题目', game: true }
        },
        {
            path: '/gamerule',
            name: 'gamrule',
            component: () => import('./pages/Gamerule.vue'),
            meta: { title: '游戏规则' }
        },
        {
            path: '/about',
            name: 'about',
            component: () => import('./pages/About.vue'),
            meta: { title: '关于' }
        },
        {
            path: '/problems',
            name: 'problems',
            component: () => import('./pages/Problems.vue'),
            meta: { title: '题目列表', game: true }
        },
        {
            path: '/login',
            name: 'login',
            component: () => import('./pages/Login.vue'),
            meta: { title: '登录' }
        },
        {
            path: '/register',
            name: 'register',
            component: () => import('./pages/Register.vue'),
            meta: { title: '注册' }
        },
        {
            path: '/settings',
            name: 'settings',
            component: () => import('./pages/Settings.vue'),
            meta: { title: '账户设置' }
        },
        {
            path: '/game/:pid',
            name: 'game',
            component: () => import('./pages/Game.vue'),
            meta: { title: '游戏', game: true }
        },
        {
            path: '/record/:pid?',
            name: 'record',
            component: () => import('./pages/Record.vue'),
            meta: { title: '提交记录', game: true }
        },
        {
            path: '/rank',
            name: 'rank',
            component: () => import('./pages/Rank.vue'),
            meta: { title: '排行榜', game: true }
        },
        {
            path: '/users',
            name: 'users',
            component: () => import('./pages/UsersList.vue'),
            meta: { title: '用户列表', admin: true }
        },
        {
            path: '/notice',
            name: 'notice',
            component: () => import('./pages/Notice.vue'),
            meta: { title: '公告' }
        },
        {
            path: '/admin',
            name: 'admin',
            component: () => import('./pages/Admin.vue'),
            meta: { title: '管理面板', admin: true }
        },
        {
            path: '/:pathMatch(.*)*',
            name: 'notfound',
            component: () => import('./pages/NotFound.vue'),
            meta: { title: '404' }
        }
    ]
})
NProgress.configure({ showSpinner: false });

router.beforeEach(async (to, from, next) => {
    if (user.admin?.value < 1 && to.meta.admin) {
        next({ path: '/404', replace: true,  })
        return
    }
    if (to.meta.game && user.login?.value && user.admin?.value < 1) {
        const { started } = await refreshGameStatus()
        if (!started) {
            notificationManager.add({
                message: `游戏未开始`,
                type: 'error',
                time: 5000,
            })
            next({ path: '/', replace: true })
            return
        }
    }
    document.title = to.meta.title + " | " + title 
    NProgress.start()
    next();
});


router.afterEach(() => {
    NProgress.done()
})


export default router
