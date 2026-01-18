export type BaseResponse<T> = {
    success: boolean;
} & T;

export type BasePageResponse<T> = BaseResponse<{
    data: T[];
    count: number;
}>;

export type BaseDataResponse<T> = BaseResponse<{
    data: T;
}>;

export type Subscription = {
    trade_no: string;
    level: "LEVEL1" | "LEVEL0" | string;
    price: number;
    is_cancel: 0 | 1;
    status: "CANCEL" | "" | string;
    created_at: string;  // ISO 8601 date string
    updated_at: string;  // ISO 8601 date string
    expired_at: string;  // ISO 8601 date string
    payment_method: "Credit_CreditCard" | "unknown" | string;
    username: string;
    avatar: string;
};

export type Post = {
    id: number;
    title: string;
    title_en: string;
    title_zh: string;
    content: string;
    content_en: string | null;
    content_zh: string;
    images: string;
    type: "VIDEO" | "BASIC" | string;
    permission: "PAID_OR_SUBSCRIPTION" | "PAID" | "FREE" | "ONLY_PAID" | string;
    price: number;
    subscription_level: "LEVEL1" | "LEVEL0" | string;
    created_at: string;  // ISO 8601 date string
    updated_at: string;  // ISO 8601 date string
    video: string;
    domain: string;
    video_status: "SUCCESS" | "FAILED" | string;
    preview: string;
    thumb: string;
    tags: string;
    comment_num: number;
    like_num: number;
    is_pin: number;
    view_num: number;
    is_enable_post_revenue: number;
    can_view: number;
    username: string;
    displayname: string;
    avatar: string;
    cover: string;
    user_subscription_level: string; // JSON string
    is_enable_video_copyright_protect: number;
    is_enable_photo_copyright_protect: number;
    is_admin: number;
    isBookmark: boolean;
    isLike: boolean;
    imageCount: number;
    blurImageUrl: string;
    isSubscriptioning: boolean;
};