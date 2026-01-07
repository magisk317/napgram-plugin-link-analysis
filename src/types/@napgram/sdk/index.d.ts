declare module '@napgram/sdk' {
  export interface NapGramPlugin {
    id: string;
    name: string;
    version: string;
    author?: string;
    description?: string;
    homepage?: string;
    permissions?: PluginPermissions;
    install(ctx: PluginContext, config?: any): void | Promise<void>;
    uninstall?(): void | Promise<void>;
    reload?(): void | Promise<void>;
  }

  export interface PluginPermissions {
    instances?: Array<number | string>;
    network?: string[];
    fs?: string[];
  }

  export interface PluginContext {
    readonly pluginId: string;
    readonly logger: PluginLogger;
    readonly config: any;
    readonly storage: PluginStorage;

    on(event: 'message', handler: MessageEventHandler): EventSubscription;
    on(event: 'friend-request', handler: FriendRequestEventHandler): EventSubscription;
    on(event: 'group-request', handler: GroupRequestEventHandler): EventSubscription;
    on(event: 'notice', handler: NoticeEventHandler): EventSubscription;
    on(event: 'instance-status', handler: InstanceStatusEventHandler): EventSubscription;
    on(event: 'plugin-reload', handler: PluginReloadEventHandler): EventSubscription;

    readonly message: MessageAPI;
    readonly instance: InstanceAPI;
    readonly user: UserAPI;
    readonly group: GroupAPI;

    onReload(callback: () => void | Promise<void>): void;
    onUnload(callback: () => void | Promise<void>): void;
  }

  export interface EventSubscription {
    unsubscribe(): void;
  }

  export type PluginWithConfig<TConfig = unknown> = Omit<NapGramPlugin, 'install'> & {
    install(ctx: PluginContext, config?: TConfig): void | Promise<void>;
  };

  export function definePlugin<TConfig = unknown, T extends PluginWithConfig<TConfig> = PluginWithConfig<TConfig>>(plugin: T): T;

  export interface MessageEvent {
    eventId: string;
    instanceId: number;
    platform: 'qq' | 'tg';
    channelId: string;
    channelRef?: string;
    channelType: 'group' | 'private' | 'channel';
    threadId?: number;
    sender: {
      userId: string;
      userName: string;
      userNick?: string;
      isAdmin?: boolean;
      isOwner?: boolean;
    };
    message: {
      id: string;
      ref?: string;
      text: string;
      segments: MessageSegment[];
      timestamp: number;
      quote?: {
        id: string;
        userId: string;
        text: string;
      };
    };
    raw: any;
    reply(content: string | MessageSegment[]): Promise<SendMessageResult>;
    send(content: string | MessageSegment[]): Promise<SendMessageResult>;
    recall(): Promise<void>;
  }

  export interface FriendRequestEvent {
    eventId: string;
    instanceId: number;
    platform: 'qq' | 'tg';
    requestId: string;
    userId: string;
    userName: string;
    comment?: string;
    timestamp: number;
    approve(): Promise<void>;
    reject(reason?: string): Promise<void>;
  }

  export interface GroupRequestEvent {
    eventId: string;
    instanceId: number;
    platform: 'qq' | 'tg';
    requestId: string;
    groupId: string;
    userId: string;
    userName: string;
    comment?: string;
    timestamp: number;
    approve(): Promise<void>;
    reject(reason?: string): Promise<void>;
  }

  export interface NoticeEvent {
    eventId: string;
    instanceId: number;
    platform: 'qq' | 'tg';
    noticeType: NoticeType;
    groupId?: string;
    userId?: string;
    operatorId?: string;
    duration?: number;
    timestamp: number;
    raw: any;
  }

  export type NoticeType =
    | 'group-member-increase'
    | 'group-member-decrease'
    | 'group-admin'
    | 'group-ban'
    | 'group-recall'
    | 'friend-add'
    | 'friend-recall'
    | 'other';

  export interface InstanceStatusEvent {
    instanceId: number;
    status: InstanceStatus;
    error?: Error;
    timestamp: number;
  }

  export type InstanceStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

  export interface PluginReloadEvent {
    pluginId: string;
    timestamp: number;
  }

  export type MessageSegment =
    | TextSegment
    | AtSegment
    | ReplySegment
    | ImageSegment
    | VideoSegment
    | AudioSegment
    | FileSegment
    | ForwardSegment
    | RawSegment;

  export interface TextSegment {
    type: 'text';
    data: { text: string };
  }

  export interface AtSegment {
    type: 'at';
    data: { userId: string; userName?: string };
  }

  export interface ReplySegment {
    type: 'reply';
    data: { messageId: string };
  }

  export interface ImageSegment {
    type: 'image';
    data: { url?: string; file?: string; base64?: string };
  }

  export interface VideoSegment {
    type: 'video';
    data: { url?: string; file?: string };
  }

  export interface AudioSegment {
    type: 'audio';
    data: { url?: string; file?: string };
  }

  export interface FileSegment {
    type: 'file';
    data: { url?: string; file?: string; name?: string };
  }

  export interface ForwardSegment {
    type: 'forward';
    data: { messages: ForwardMessage[] };
  }

  export interface ForwardMessage {
    userId: string;
    userName: string;
    segments: MessageSegment[];
  }

  export interface RawSegment {
    type: 'raw';
    data: { platform: 'qq' | 'tg'; content: any };
  }

  export interface MessageAPI {
    send(params: SendMessageParams): Promise<SendMessageResult>;
    recall(params: RecallMessageParams): Promise<void>;
    get(params: GetMessageParams): Promise<MessageInfo | null>;
  }

  export interface SendMessageParams {
    instanceId: number;
    channelId: string;
    content: string | MessageSegment[];
    threadId?: number;
    replyTo?: string;
  }

  export interface SendMessageResult {
    messageId: string;
    timestamp: number;
  }

  export interface RecallMessageParams {
    instanceId: number;
    messageId: string;
  }

  export interface GetMessageParams {
    instanceId: number;
    messageId: string;
  }

  export interface MessageInfo {
    id: string;
    channelId: string;
    userId: string;
    text: string;
    segments: MessageSegment[];
    timestamp: number;
  }

  export interface InstanceAPI {
    list(): Promise<InstanceInfo[]>;
    get(instanceId: number): Promise<InstanceInfo | null>;
    getStatus(instanceId: number): Promise<InstanceStatus>;
  }

  export interface InstanceInfo {
    id: number;
    name?: string;
    qqAccount?: string;
    tgAccount?: string;
    createdAt: Date;
  }

  export interface UserAPI {
    getInfo(params: GetUserParams): Promise<UserInfo | null>;
    isFriend(params: GetUserParams): Promise<boolean>;
  }

  export interface GetUserParams {
    instanceId: number;
    userId: string;
  }

  export interface UserInfo {
    userId: string;
    userName: string;
    userNick?: string;
    avatar?: string;
  }

  export interface GroupAPI {
    getInfo(params: GetGroupParams): Promise<GroupInfo | null>;
    getMembers(params: GetGroupParams): Promise<GroupMember[]>;
    setAdmin(params: SetAdminParams): Promise<void>;
    muteUser(params: MuteUserParams): Promise<void>;
    kickUser(params: KickUserParams): Promise<void>;
  }

  export interface GetGroupParams {
    instanceId: number;
    groupId: string;
  }

  export interface GroupInfo {
    groupId: string;
    groupName: string;
    memberCount?: number;
  }

  export interface GroupMember {
    userId: string;
    userName: string;
    userNick?: string;
    role: 'owner' | 'admin' | 'member';
  }

  export interface SetAdminParams {
    instanceId: number;
    groupId: string;
    userId: string;
    enable: boolean;
  }

  export interface MuteUserParams {
    instanceId: number;
    groupId: string;
    userId: string;
    duration: number;
  }

  export interface KickUserParams {
    instanceId: number;
    groupId: string;
    userId: string;
    rejectAddRequest?: boolean;
  }

  export interface PluginStorage {
    get<T = any>(key: string): Promise<T | null>;
    set<T = any>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
    clear(): Promise<void>;
  }

  export interface PluginLogger {
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
  }

  export type MessageEventHandler = (event: MessageEvent) => void | Promise<void>;
  export type FriendRequestEventHandler = (event: FriendRequestEvent) => void | Promise<void>;
  export type GroupRequestEventHandler = (event: GroupRequestEvent) => void | Promise<void>;
  export type NoticeEventHandler = (event: NoticeEvent) => void | Promise<void>;
  export type InstanceStatusEventHandler = (event: InstanceStatusEvent) => void | Promise<void>;
  export type PluginReloadEventHandler = (event: PluginReloadEvent) => void | Promise<void>;
}
