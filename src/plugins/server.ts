import type { PluginServerApi, ServerContext } from '../types';

/** 交互题事件分发器（对应 mijie 的 PluginServer） */
export class PluginServer implements PluginServerApi {
  private handlers = new Map<string, (data: any, ctx: ServerContext) => any>();
  private adminHandlers = new Map<string, (data: any, ctx: ServerContext) => any>();

  on<E = any>(event: string, handler: (data: E, ctx: ServerContext) => any): void {
    this.handlers.set(event, async (data, ctx) => await handler(data, ctx));
  }

  adminOn<E = any>(event: string, handler: (data: E, ctx: ServerContext) => any): void {
    this.adminHandlers.set(event, async (data, ctx) => await handler(data, ctx));
  }

  async handle(event: string, data: any, ctx: ServerContext): Promise<any> {
    return await this.handlers.get(event)?.(data, ctx);
  }

  async adminHandle(event: string, data: any, ctx: ServerContext): Promise<any> {
    return await this.adminHandlers.get(event)?.(data, ctx);
  }
}
