import { LiveRoomInfo } from ".";

export interface IBiliHttpApi {
  getLiveRoomInfo(roomId: number | string): Promise<LiveRoomInfo>;
  getLiveStreamUrl(roomId: number | string): Promise<string[]>;
}

export interface Response<T> {
  code: number;
  message: string;
  ttl?: number;
  data: T;
}
