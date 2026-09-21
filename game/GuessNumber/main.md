**目标数字**是一个位于 1-99 范围内的整数。你可以随意输入任何一个数字，我会告诉你这个数字比目标大了还是小了，还是正好相同。

如果正好相同，那你就过关了。

你有 7 次机会来猜出数字；如果在 7 次之内都没有猜对，那么本关将进行重置。

<script setup>
import {inject} from "vue";
const api=inject("api");
await api("init_if_not_defined");
</script>
