本关需要你输入一段内容。

不过，这段内容被四种不同的力量共同屏蔽掉了。每当你解开一道前置谜题，都能恢复一部分的内容。现在你可以回到题目列表去查看它们。

你需要输入完整的内容才可以通关。

<blockquote>
{{ content }}
</blockquote>

<App/>

<script setup>
import {inject,ref} from "vue";
const api=inject("api");
const content=ref("");
api("refresh").then(data=>{
    content.value=data;
});
</script>
