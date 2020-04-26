import SocketIO from 'socket.io';
import * as http from 'http';
import { PositionType, User } from '$components/user';
import { RoomInstance } from '$components/room';
import { Server, Socket } from '$utils/index';
import {
  Choice,
  InnerFieldDictionary,
  OuterFieldDictionary,
  OPTION_CHOICES,
  ResourceType,
  INNER_FIELDS, FieldType,
} from '$components/field';


type Room = {
  room?: RoomInstance;
}

type Message = {
  name: string;
  message: string;
  color: string;
}

export class Game {
  private Server: Server<Room, User>;

  constructor(port?: number | http.Server) {
    this.Server = SocketIO(port);
    this.Server.emit('connect:error');

    this.Server.on('connection', (socket: Socket<User>) => {
      socket.on('login', ({ username }) => {
        socket.user = new User(username);

        socket.emit('rooms', {
          rooms: this.getRooms(),
        });

        socket.on('room:create', ({ roomName }) => {
          socket.user!.createRoom(roomName);
          socket.join(roomName);

          this.Server.sockets.adapter.rooms[roomName].room = new RoomInstance(roomName);
          this.sendRooms();
        });

        socket.on('room:choice', ({ roomName }) => {
          socket.user!.choiceRoom(roomName);

          socket.join(roomName);

          this.sendPlayers(roomName);
          this.sendRooms();
        });

        socket.on('room:leave', () => {
          const room = socket.user!.getCurrentRoom();
          const userIds = this.getUsersInRoom(room);

          socket.leave(room);
          if (userIds.length) {
            this.sendPlayers(room);
          }

          socket.user!.leaveRoom();
          this.sendRooms();
        });

        socket.on('game:start', () => {
          const room = socket.user!.getCurrentRoom();

          this.gameStart(room);
        });

        socket.on('game:dream', dreamId => {
          const room = socket.user!.getCurrentRoom();
          socket.user!.setDream(dreamId);

          this.sendPlayersWithDream(room);
        });

        socket.on('game:move', (move: number) => {
          const room = socket.user!.getCurrentRoom();
          socket.user!.setPosition(move);

          this.sendPlayersWithCard(room, socket.user!.priority!);
        });

        socket.on('game:choice', (choice: Choice) => {
          const room = socket.user!.getCurrentRoom();

          const isFieldChanged = socket.user!.updateAfterChoice(choice);

          if (OPTION_CHOICES.includes(choice.type)) {
            socket.in(room).emit('game:user-choice', `${choice['choiceId']}`);
          }
          if (socket.user!.winner) {
            setTimeout(() => {
              this.Server.in(room).emit('game:players', this.getUsersInRoom(room))
            }, 1000);
          } else if (isFieldChanged) {
            this.sendPlayersWithCard(room, socket.user!.priority!);
          } else {
            this.sendPlayersWithNext(room, socket.user!.priority! + 1);
          }
        });

        socket.on('game:remove-dark', (key: ResourceType) => {
          const room = socket.user!.getCurrentRoom();
          socket.user!.removeDark(key);

          this.sendPlayers(room);
        })
      });

      socket.on('chat:room-message', (message: Message) => {
        const userRoom = socket.user!.getCurrentRoom();
        if (userRoom) {
          this.Server.in(userRoom).emit('chat:room-message', message)
        }
      });

      socket.on('chat:message', (message: Message) => {
        this.Server.emit('chat:message', message)
      });

      socket.on('disconnect', () => {
        if (socket.user) {
          const userRoom = socket.user.getCurrentRoom();
          socket.user.disconnect();
          if (userRoom) {
            this.sendPlayers(userRoom);
          }
        }

        this.sendRooms();
      })
    });
  }

  sendRooms() {
    this.Server.emit('rooms', {
      rooms: this.getRooms(),
    })
  }

  sendPlayers(roomName: string) {
    this.Server.in(roomName).emit('game:players', this.getUsersInRoom(roomName))
  }

  sendPlayersWithDream(roomName: string) {
    const users = this.getUsersInRoom(roomName);
    const dreamsExist = users.every(user => user.dream);

    this.Server.in(roomName).emit('game:players', users.map(user => {
      if (user.priority === 0 && dreamsExist) {
        return {
          ...user,
          currentMove: true
        }
      }

      return user;
    }))
  }

  sendPlayersWithNext(roomName: string, nextPlayer: number) {
    const users = this.getUsersInRoom(roomName);

    this.Server.in(roomName).emit('game:players', getUserWithMover(users, nextPlayer))
  }

  sendPlayersWithCard(roomName: string, currentPlayer: number) {
    const users = this.getUsersInRoom(roomName);
    let moveCancel = false;

    const newUsers = users.map(user => {
      if (user.priority === currentPlayer) {
        const { type, cell } = user.position!;

        if (type === PositionType.inner) {
          return {
            ...user,
            ...InnerFieldDictionary[cell]
          }
        }

        if (type === PositionType.outer) {
          const result = OuterFieldDictionary(user.dream!, user.resources!.white!)[cell];
          moveCancel = true;

          if (typeof result === 'number') {
            user.setResources({ white: result });

            return user;
          }

          if (result) {
            moveCancel = false;
            return {
              ...user,
              ...result,
            }
          } else {
            user.win();
            return user;
          }
        }
      }

      return user;
    });

    moveCancel
      ? this.sendPlayersWithNext(roomName, currentPlayer + 1)
      : this.Server.in(roomName).emit('game:players', newUsers)
  }

  getRooms() {
    return Object.keys(this.Server.sockets.adapter.rooms)
      .filter(roomName => (
        this.Server.sockets.adapter.rooms[roomName].room?.isAwait()) &&
        this.Server.sockets.adapter.rooms[roomName].length <= 8
      )
      .map(roomName => {
        const userCount = this.Server.sockets.adapter.rooms[roomName].length;

        return {
          roomName,
          userCount
        }
    });
  }

  gameStart(roomName: string) {
    const users = this.getUsersInRoom(roomName);

    this.Server.sockets.adapter.rooms[roomName].room?.gameStart();
    this.sendRooms();

    this.Server.in(roomName).emit('game:started');
    this.Server.in(roomName).emit('game:players', users.map((user, i) => {
      user.setPriority(i);
      user.gameStart();

      return user;
    }))
  }

  getUsersInRoom(roomName: string) {
    const userIds = this.Server.sockets.adapter.rooms[roomName]?.sockets;

    if (userIds) {
      const users = Object.keys(userIds).map(userId => {
        return this.Server.sockets.connected[userId].user!;
      });

      if (!users.some(user => user.admin)) {
        users[0].admin = true;
      }

      return users;
    }

    return [];
  }
}

function getUserWithMover(users: Partial<User>[], currentPlayer) {
  const activeUsers = users.filter(user => !user.gameover);

  if (activeUsers.length === 0) {
    return users;
  }

  if (activeUsers.length === 1) {
    if (activeUsers[0].win) {
      activeUsers[0].win();
    }

    return users;
  }

  const usersCount = users.length;
  let isCurrentMoverSet = false;
  let nextPlayer = currentPlayer % usersCount;

  const newUsers = users.map(user => {
    if (user.priority === nextPlayer) {
      if (user.gameover) {
        nextPlayer = nextPlayer + 1;
        return user;
      }

      if (user.hold) {
        nextPlayer = nextPlayer + 1;
        user.await && user.await();

        return user;
      }

      isCurrentMoverSet = true;
      return {
        ...user,
        currentMove: true
      }
    }

    return user;
  });

  if (isCurrentMoverSet) {
    return newUsers;
  }

  return getUserWithMover(newUsers, nextPlayer)
}
