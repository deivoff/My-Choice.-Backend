import { Injectable } from '@nestjs/common';
import { InjectModel } from 'nestjs-typegoose';
import { ReturnModelType } from '@typegoose/typegoose';

import { User } from 'src/user/entities/user.entity';
import { AuthData } from 'src/auth/types/auth.types';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User) private readonly userModel: ReturnModelType<typeof User>
  ) {}
  async upsertVKUser({ accessToken, profile: {
    name, id, photos
  } }: AuthData, onNewUser?: () => void) {
    try {
      const user = await this.userModel.findOne({ 'social.vkProvider.id': id });
      if (!user) {
        if (onNewUser) {
          onNewUser();
        }
        return await this.userModel.create({
          name,
          // @ts-ignore
          'social.vkProvider': {
            id,
            token: accessToken,
          },
          photos,
        });
      }
      return user;
    } catch (error) {
      throw error;
    }
  }
}
