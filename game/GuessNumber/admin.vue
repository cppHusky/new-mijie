<template>
	<p>{{ ans }}</p>
	<button @click="get">查看答案</button>
</template>
<script setup>
import {inject,ref} from "vue";
const ans=ref("ans");
const api=inject("admin_api");
async function get(){
	ans.value=await api("get");
}
</script>
