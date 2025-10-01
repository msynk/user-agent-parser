export interface UserAgentData {
    brands: UserAgentDataBrand[];
    mobile: boolean;
    platform: string;
}

export interface UserAgentDataBrand {
    brand: string;
    version: string;
}

export interface UserAgentInfo {
    browser: { name: string; version: string; };
    os: { name: string; version: string; };
    device: { type: "Mobile" | "Desktop" };
    engine: string;
    userAgent: string;
    platform: string;
    source: string;
}