import { Scalar, CustomScalar } from '@nestjs/graphql';
import { Kind, ValueNode } from 'graphql';
import { Types } from 'mongoose';

export type ID = string | Types.ObjectId;
export function objectIdToString(objectId: ID) {
  return typeof objectId === 'string' ? objectId : objectId.toHexString()
}

@Scalar('ObjectId', () => Types.ObjectId)
export class ObjectIdScalar implements CustomScalar<string, Types.ObjectId> {
  description = 'Mongo objectId scalar type';

  parseValue(value: string) {
    return new Types.ObjectId(value);
  }

  serialize = objectIdToString;

  parseLiteral(ast: ValueNode) {
    if (ast.kind === Kind.STRING) {
      return new Types.ObjectId(ast.value); // value from the client query
    }
    return null;
  }

}
