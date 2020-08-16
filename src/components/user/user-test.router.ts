import Router from 'koa-router';
import { UserTestModel } from '$components/user/user-test.entity';

const userTestRouter = new Router();

userTestRouter.get('/user', async (ctx, next) => {
  const { id } = ctx.request.query;

  if (!id) {
    ctx.status = 400;
    ctx.body = 'Bad request'
  }

  try {
    const user = await UserTestModel.findOne({ id }, {
      firstName: 1,
      lastName: 1,
      id: 1,
      result: 1,
    });

    if (!user) {
      ctx.status = 404;
      ctx.body = 'User not found';
      return next();
    }

    ctx.body = user;
    return next();
  } catch (err) {
    err.status = err.statusCode || err.status || 500;
    ctx.body = err.message;
    ctx.app.emit('error', err, ctx);
  }
});

export default userTestRouter;
