import userSchema from './userSchema';
import textSchema from './textSchema';
import optionsSchema from './optionsSchema';
import customSchema from './customSchema';
import updateSchema from './updateSchema';

const JSON = require('circular-json');

const schema = {
  parse(step) {
    let parser = [];

    if (step.user) {
      parser = userSchema;
    } else if (step.message) {
      parser = textSchema;
    } else if (step.options) {
      parser = optionsSchema;
    } else if (step.component) {
      parser = customSchema;
    } else if (step.update) {
      parser = updateSchema;
    } else {
      // throw new Error(`The step ${JSON.stringify(step)} is invalid`);
      console.log("err", "Warning: step.message = " + step.message);
      step.message = "empty";  //temp solution.
      parser = textSchema;
    }
    //only deal with text and option for now.
    if(step.count && step.count > 1){
      parser = optionsSchema;
    }

    for (let i = 0, len = parser.length; i < len; i += 1) {
      const { key, types, required } = parser[i];

      if (!step[key] && required) {
        throw new Error(`Key '${key}' is required in step ${JSON.stringify(step)}`);
      } else if (step[key]) {
        if (types[0] !== 'any' && types.indexOf(typeof step[key]) < 0) {
          throw new Error(
            `The type of '${key}' value must be ${types.join(' or ')} instead of ${typeof step[
              key
            ]}`
          );
        }
      }
    }

    const keys = parser.map(p => p.key);

    for (const key in step) {
      if (keys.indexOf(key) < 0) {
        console.error(`scheme Invalid key '${key}' in step '${step.id}'`);
        console.error("scheme step", step)
        delete step[key];
      }
      // if(key=='bot')
      //    console.log("schema", "key="+ key + ". bot="+ step.bot)
    }

    return step;
  },

  checkInvalidIds(steps) {
    for (const key in steps) {
      const step = steps[key];
      const triggerId = steps[key].trigger;
      // console.log("checkInvalidIds key", key)
      // console.log("checkInvalidIds step", step)

      if (typeof triggerId !== 'function') {
        if (!step.message) {
          if(step.options == undefined)
            continue
          const triggers = step.options.filter(option => typeof option.trigger !== 'function');
          const optionsTriggerIds = triggers.map(option => option.trigger);

          for (let i = 0, len = optionsTriggerIds.length; i < len; i += 1) {
            const optionTriggerId = optionsTriggerIds[i];
            if (optionTriggerId && !steps[optionTriggerId]) {
              console.error( `The id '${optionTriggerId}' triggered by option ${i + 1} in step '${
                     steps[key].id
                   }' does not exist`)
              // throw new Error(
              //   `The id '${optionTriggerId}' triggered by option ${i + 1} in step '${
              //     steps[key].id
              //   }' does not exist`
              // );
            }
          }
        } else if (triggerId && !steps[triggerId]) {
          console.error( 'err', `The id '${triggerId}' triggered by step '${steps[key].id}' does not exist`)
          // throw new Error(
          //   `The id '${triggerId}' triggered by step '${steps[key].id}' does not exist`
          // );
        }
      }
    }
  }
};

export default schema;
