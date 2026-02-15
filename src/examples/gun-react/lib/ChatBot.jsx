import xs from 'xstream';
import dropRepeats from 'xstream/extra/dropRepeats';
import sampleCombine from 'xstream/extra/sampleCombine';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Random from 'random-id';
import { CustomStep, OptionsStep, TextStep } from './steps_components';
import schema from './schemas/schema';
import * as storage from './storage';
import {
  ChatBotContainer,
  Content,
  Header,
  HeaderTitle,
  HeaderIcon,
  FloatButton,
  FloatingIcon,
  Footer,
  Input,
  SubmitButton,
  ChatList
} from './components';
import Recognition from './recognition';
import { ChatIcon, CloseIcon, SubmitIcon, MicIcon } from './icons';
import { isMobile } from './utils';
import { speakFn } from './speechSynthesis';

import { Entity } from '../Entity'
import { set } from 'lodash';
import { div, form, ul, li, h1, input, button, p } from '@cycle/react-dom';


const formatMsgs = msgs => Object.keys(msgs)
  .map(key => ({ id: key, ...msgs[key] }))
  .filter(m => Boolean(m.when) && m.key !== '_')
  .sort((a, b) => a.when - b.when)
  .map(m => ((m.whenFmt = new Date(m.when).toLocaleString().toLowerCase()), m))

//, m.id=m.key, m.value=1, m.metadata='')
class ChatBot_old extends Component {
  /* istanbul ignore next */
  constructor(props) {
    super(props);
    this.entity = props.entity;

    this.content = null;
    this.input = null;

    this.setContentRef = element => {
      this.content = element;
    };

    this.setInputRef = element => {
      this.input = element;
    };

    this.state = {
      renderedSteps: [],
      previousSteps: [],
      currentStep: {},
      previousStep: {},
      steps: {},
      disabled: false,
      opened: props.opened || !props.floating,
      inputValue: '',
      inputInvalid: false,
      speaking: false,
      recognitionEnable: props.recognitionEnable && Recognition.isSupported(),
      defaultUserSettings: {},
      stageName: this.entity.getStageName(),
      msgs: {}
    };

    this.speak = speakFn(props.speechSynthesis);
  }

  updateUIChatBot = obj => {
    if (obj.stageName) {
      this.setState(obj);
      return;
    }

    //assume it has msgs.
    if (obj.msgs) {
      const msgs = formatMsgs(obj.msgs)
      // msgs.forEach(a => {
      //   // console.log("Bernard", "a.key=" + a.key + ". msg=" + a.message + '. bot='+ a.bot)
      //   console.log("BernardChatbot", a)
      // })
      // console.log("ChatBox after format msgs=", msgs)

      this.processSteps(msgs);
      // msgs.forEach(a => {
      //   // console.log("Bernard", "a.key=" + a.key + ". msg=" + a.message + '. bot='+ a.bot)
      //   console.log("BernardChatbot2", a)
      // })

    }

  }

  processSteps = steps => {
    const {
      botDelay,
      botAvatar,
      cache,
      cacheName,
      customDelay,
      enableMobileAutoFocus,
      userAvatar,
      userDelay
    } = this.props;
    const chatSteps = {};

    const defaultBotSettings = { delay: botDelay, avatar: botAvatar };
    // const defaultUserSettings = { delay: userDelay, avatar: userAvatar, hideInput: false };
    // const defaultCustomSettings = { delay: customDelay };

    for (let i = 0, len = steps.length; i < len; i += 1) {
      const step = steps[i];
      let settings = {};

      // if (step.user) {
      //   settings = defaultUserSettings;
      // } else if (step.message || step.asMessage) {
        settings = defaultBotSettings;
      // } else if (step.component) {
      //   settings = defaultCustomSettings;
      // }

      // console.log("chatbot before", step)
      chatSteps[step.id] = Object.assign({}, settings, schema.parse(step));

      // console.log("chatbot", "step.bot=" + step.bot + ". charstep.bot=" + chatSteps[step.id].bot)
      // console.log("chatbot after", step)
    }
    // console.log("chatbot after forloop chatSteps=", chatSteps)

    schema.checkInvalidIds(chatSteps);

    let firstStep = {}
    // console.log("chatbot chatSteps.length=", chatSteps.length)

    // if (chatSteps.length > 0) {
    //   firstStep = chatSteps[0];

    //   if (firstStep.message) {
    //     const { message } = firstStep;
    //     firstStep.message = typeof message === 'function' ? message() : message;
    //     chatSteps[firstStep.id].message = firstStep.message;
    //   }

    // }

    const { recognitionEnable } = this.state;
    const { recognitionLang } = this.props;

    if (recognitionEnable) {
      this.recognition = new Recognition(
        this.onRecognitionChange,
        this.onRecognitionEnd,
        this.onRecognitionStop,
        recognitionLang
      );
    }

    if (this.content) {
      this.content.addEventListener('DOMNodeInserted', this.onNodeInserted);
      window.addEventListener('resize', this.onResize);
    }

    // console.log("Chatbot before renderedSteps=", renderedSteps)
    const { currentStep, previousStep, previousSteps, renderedSteps } = storage.getData(
      {
        cacheName,
        cache,
        firstStep,
        steps: chatSteps
      },
      () => {
        // focus input if last step cached is a user step
        this.setState({ disabled: false }, () => {
          if (enableMobileAutoFocus || !isMobile()) {
            if (this.input) {
              this.input.focus();
            }
          }
        });
      }
    );
    const d = new Date();
    const tlimit = d.getTime() - 1000*60*60*24*1;
    const re1 = renderedSteps.filter( x => x.when > tlimit)
    // console.log("size of re1 is array = ", Array.isArray(re1))
    // console.log("size of re1 = ", re1.length)
    // const re2 = [... new Set(re1)]
    const re3 = re1.filter((o, i) => 
      !i || !(o.stageName == re1[i-1].stageName && o.message == re1[i-1].message));
    // console.log("size of re3 is array = ", Array.isArray(re3))
    // console.log("size of re3 = ", re3.length)

    // console.log(re3[re3.length-2])
    // console.log(re3[re3.length-1])
    // console.log("Chatbot renderedSteps=", renderedSteps)
    // console.log("Chatbot steps=", chatSteps)
    this.setState({
      // currentStep,
      // defaultUserSettings,
      // previousStep,
      // previousSteps,
      renderedSteps: re3,
      steps: chatSteps
    });
  }

  componentDidMount() {
    console.log("ChatBot", "componentDidMount")

    this.entity && this.entity.onChatBotMessage(this.updateUIChatBot)

  }


  static getDerivedStateFromProps(props, state) {
    const { opened, toggleFloating } = props;
    if (toggleFloating !== undefined && opened !== undefined && opened !== state.opened) {
      return {
        ...state,
        opened
      };
    }
    return state;
  }

  componentWillUnmount() {
    console.log("ChatBot", "componentWillUnmount")
    if (this.content) {
      this.content.removeEventListener('DOMNodeInserted', this.onNodeInserted);
      window.removeEventListener('resize', this.onResize);
    }
  }

  onNodeInserted = event => {
    event.currentTarget.scrollTop = event.currentTarget.scrollHeight;
  };

  onResize = () => {
    this.content.scrollTop = this.content.scrollHeight;
  };

  onRecognitionChange = value => {
    this.setState({ inputValue: value });
  };

  onRecognitionEnd = () => {
    this.setState({ speaking: false });
    this.handleSubmitButton();
  };

  onRecognitionStop = () => {
    this.setState({ speaking: false });
  };

  onValueChange = event => {
    this.setState({ inputValue: event.target.value });
  };

  getTriggeredStep = (trigger, value) => {
    const steps = this.generateRenderedStepsById();
    return typeof trigger === 'function' ? trigger({ value, steps }) : trigger;
  };

  getStepMessage = message => {
    const { previousSteps } = this.state;
    const lastStepIndex = previousSteps.length > 0 ? previousSteps.length - 1 : 0;
    const steps = this.generateRenderedStepsById();
    const previousValue = previousSteps[lastStepIndex].value;
    return typeof message === 'function' ? message({ previousValue, steps }) : message;
  };

  generateRenderedStepsById = () => {
    const { previousSteps } = this.state;
    const steps = {};

    for (let i = 0, len = previousSteps.length; i < len; i += 1) {
      if (!previousSteps[i])
        continue;
      const { id, message, value, metadata } = previousSteps[i];

      steps[id] = {
        id,
        message,
        value,
        metadata
      };
    }

    return steps;
  };

  triggerNextStep = data => {
    const { enableMobileAutoFocus } = this.props;
    const { defaultUserSettings, previousSteps, renderedSteps, steps } = this.state;

    let { currentStep, previousStep } = this.state;
    const isEnd = currentStep.end;

    console.log("TriggerNextStep data=", data);
    if( data == undefined )
      return;
    // if(data == "op0")
    //   return;
    // else
    //   return;
      
    if (data && data.value) {
      currentStep.value = data.value;
    }
    if (data && data.hideInput) {
      currentStep.hideInput = data.hideInput;
    }
    if (data && data.trigger) {
      currentStep.trigger = this.getTriggeredStep(data.trigger, data.value);
    }

    if (isEnd) {
      this.handleEnd();
    } else if (currentStep.options && data) {
      const option = currentStep.options.filter(o => o.value === data.value)[0];
      const trigger = this.getTriggeredStep(option.trigger, currentStep.value);
      delete currentStep.options;

      // replace choose option for user message
      currentStep = Object.assign({}, currentStep, option, defaultUserSettings, {
        user: true,
        message: option.label,
        trigger
      });

      renderedSteps.pop();
      previousSteps.pop();
      renderedSteps.push(currentStep);
      previousSteps.push(currentStep);

      this.setState({
        currentStep,
        renderedSteps,
        previousSteps
      });
    } else if (currentStep.trigger) {
      if (currentStep.replace) {
        renderedSteps.pop();
      }

      const trigger = this.getTriggeredStep(currentStep.trigger, currentStep.value);
      let nextStep = Object.assign({}, steps[trigger]);

      if (nextStep.message) {
        nextStep.message = this.getStepMessage(nextStep.message);
      } else if (nextStep.update) {
        const updateStep = nextStep;
        nextStep = Object.assign({}, steps[updateStep.update]);

        if (nextStep.options) {
          for (let i = 0, len = nextStep.options.length; i < len; i += 1) {
            nextStep.options[i].trigger = updateStep.trigger;
          }
        } else {
          nextStep.trigger = updateStep.trigger;
        }
      }

      nextStep.key = Random(24);

      previousStep = currentStep;
      currentStep = nextStep;

      this.setState({ renderedSteps, currentStep, previousStep }, () => {
        if (nextStep.user) {
          this.setState({ disabled: false }, () => {
            if (enableMobileAutoFocus || !isMobile()) {
              if (this.input) {
                this.input.focus();
              }
            }
          });
        } else {
          renderedSteps.push(nextStep);
          previousSteps.push(nextStep);

          this.setState({ renderedSteps, previousSteps });
        }
      });
    }

    const { cache, cacheName } = this.props;
    if (cache) {
      setTimeout(() => {
        storage.setData(cacheName, {
          currentStep,
          previousStep,
          previousSteps,
          renderedSteps
        });
      }, 300);
    }
  };

  handleEnd = () => {
    const { handleEnd } = this.props;

    if (handleEnd) {
      const { previousSteps } = this.state;

      const renderedSteps = previousSteps.map(step => {
        const { id, message, value, metadata } = step;

        return {
          id,
          message,
          value,
          metadata
        };
      });

      const steps = [];

      for (let i = 0, len = previousSteps.length; i < len; i += 1) {
        const { id, message, value, metadata } = previousSteps[i];

        steps[id] = {
          id,
          message,
          value,
          metadata
        };
      }

      const values = previousSteps.filter(step => step.value).map(step => step.value);

      handleEnd({ renderedSteps, steps, values });
    }
  };

  isInputValueEmpty = () => {
    const { inputValue } = this.state;
    // console.log("InputValue =" + inputValue);
    // if(/\S/.test(inputValue)){
    //   console.log("Bernard", "not empty");
    // }else{
    //   var vv = !inputValue || inputValue.length === 0 || !(/\S/.test(inputValue));
    //   console.log("Bernard", "empty" + vv );

    // }
    return !inputValue || inputValue.length === 0 || !(/\S/.test(inputValue));
  };

  isLastPosition = step => {
    const { renderedSteps } = this.state;
    const { length } = renderedSteps;
    const stepIndex = renderedSteps.map(s => s.key).indexOf(step.key);

    if (length <= 1 || stepIndex + 1 === length) {
      return true;
    }

    const nextStep = renderedSteps[stepIndex + 1];
    const hasMessage = nextStep.message || nextStep.asMessage;

    if (!hasMessage) {
      return true;
    }

    const isLast = step.user !== nextStep.user;
    return isLast;
  };

  isFirstPosition = step => {
    const { renderedSteps } = this.state;
    const stepIndex = renderedSteps.map(s => s.key).indexOf(step.key);

    if (stepIndex === 0) {
      return true;
    }

    const lastStep = renderedSteps[stepIndex - 1];
    const hasMessage = lastStep.message || lastStep.asMessage;

    if (!hasMessage) {
      return true;
    }

    const isFirst = step.user !== lastStep.user;
    return isFirst;
  };

  handleKeyPress = event => {
    if (event.key === 'Enter') {
      this.submitUserMessage();
    }
  };

  handleSubmitButton = () => {
    const { speaking, recognitionEnable } = this.state;

    if ((this.isInputValueEmpty() || speaking) && recognitionEnable) {
      this.recognition.speak();
      if (!speaking) {
        this.setState({ speaking: true });
      }
      return
    }

    this.submitUserMessage();
  };

  submitUserMessage = () => {

    if (!this.state.stageName) {
      console.log("err", "Sign in first!!")
      return
    }
    const { defaultUserSettings, inputValue, previousSteps, renderedSteps } = this.state;
    let { currentStep } = this.state;

    if (this.isInputValueEmpty())
      return

    const isInvalid = currentStep.validator && this.checkInvalidInput();

    if (!isInvalid) {
      const when = Entity.time()
      // const key = `${when}_${Entity.random()}`
      this.entity.sendMessage({
        // who: this.state.stageName,
        // stageName: this.state.stageName,
        when,
        where: "empty",
        message: inputValue,
        bot: false,
        // uplink: "empty",
        // downlink: "empty"
      })

      // const step = {};
      // //   message: inputValue,
      // //   value: inputValue
      // // };

      // currentStep = Object.assign({}, defaultUserSettings, currentStep, step);

      // renderedSteps.push(currentStep);
      // previousSteps.push(currentStep);

      this.setState(
        {
          inputValue: ''
        },
        () => {
          if (this.input) {
            // this.input.blur();
            this.input.focus();
          }
        }
      );
    }
  };

  checkInvalidInput = () => {
    const { enableMobileAutoFocus } = this.props;
    const { currentStep, inputValue } = this.state;
    const result = currentStep.validator(inputValue);
    const value = inputValue;

    if (typeof result !== 'boolean' || !result) {
      this.setState(
        {
          inputValue: result.toString(),
          inputInvalid: true,
          disabled: true
        },
        () => {
          setTimeout(() => {
            this.setState(
              {
                inputValue: value,
                inputInvalid: false,
                disabled: false
              },
              () => {
                if (enableMobileAutoFocus || !isMobile()) {
                  if (this.input) {
                    this.input.focus();
                  }
                }
              }
            );
          }, 2000);
        }
      );

      return true;
    }

    return false;
  };

  toggleChatBot = opened => {
    const { toggleFloating } = this.props;

    if (toggleFloating) {
      toggleFloating({ opened });
    } else {
      this.setState({ opened });
    }
  };

  renderStepFake = (step, index) => {
    console.log("fake step=" + step + ". index=" + index);
  }

  renderStep = (step, index) => {
    // console.log("renderStep index="+index, step);
    if (!step)
      return;
    const { renderedSteps, stageName } = this.state;
    const {
      avatarStyle,
      bubbleStyle,
      bubbleOptionStyle,
      customStyle,
      hideBotAvatar,
      hideUserAvatar,
      speechSynthesis
    } = this.props;
    // const { options, component, asMessage } = step;
    // const steps = this.generateRenderedStepsById();
    const previousStep = index > 0 ? renderedSteps[index - 1] : {};

    // if (component && !asMessage) {
    //   return (
    //     <CustomStep
    //       key={index}
    //       step={step}
    //       steps={steps}
    //       style={customStyle}
    //       previousStep={previousStep}
    //       previousValue={previousStep.value}
    //       triggerNextStep={this.triggerNextStep}
    //     />
    //   );
    // }

    // if (options) {
    //   return (
    //     <OptionsStep
    //       key={index}
    //       step={step}
    //       speak={this.speak}
    //       previousValue={previousStep.value}
    //       triggerNextStep={this.triggerNextStep}
    //       bubbleOptionStyle={bubbleOptionStyle}
    //     />
    //   );
    // }

    return (
      <TextStep
        key={step.id}
        step={step}
        // steps={steps}
        speak={this.speak}
        previousStep={previousStep}
        previousValue={previousStep.value}
        triggerNextStep={this.triggerNextStep}
        avatarStyle={avatarStyle}
        bubbleStyle={bubbleStyle}
        hideBotAvatar={hideBotAvatar}
        hideUserAvatar={hideUserAvatar}
        speechSynthesis={speechSynthesis}
        isFirst={this.isFirstPosition(step)}
        isLast={this.isLastPosition(step)}
        me={stageName}
        triggerNextStep={this.triggerNextStep}
        bubbleOptionStyle={bubbleOptionStyle}
    />
    );
  };

  render() {
    const {
      currentStep,
      disabled,
      inputInvalid,
      inputValue,
      opened,
      renderedSteps,
      speaking,
      recognitionEnable
    } = this.state;
    const {
      className,
      contentStyle,
      floating,
      floatingIcon,
      floatingStyle,
      footerStyle,
      headerComponent,
      headerTitle,
      hideHeader,
      hideSubmitButton,
      inputStyle,
      placeholder,
      inputAttributes,
      recognitionPlaceholder,
      style,
      submitButtonStyle,
      width,
      height
    } = this.props;

    const header = headerComponent || (
      <Header className="rsc-header">
        <HeaderTitle className="rsc-header-title">{headerTitle}</HeaderTitle>
        {floating && (
          <HeaderIcon className="rsc-header-close-button" onClick={() => this.toggleChatBot(false)}>
            <CloseIcon />
          </HeaderIcon>
        )}
      </Header>
    );

    const icon =
      (this.isInputValueEmpty() || speaking) && recognitionEnable ? <MicIcon /> : <SubmitIcon />;

    const inputPlaceholder = speaking
      ? recognitionPlaceholder
      : currentStep.placeholder || placeholder;

    const inputAttributesOverride = currentStep.inputAttributes || inputAttributes;

    return (
      <div className={`rsc ${className}`}>
        {floating && (
          <FloatButton
            className="rsc-float-button"
            style={floatingStyle}
            opened={opened}
            onClick={() => this.toggleChatBot(true)}
          >
            {typeof floatingIcon === 'string' ? <FloatingIcon src={floatingIcon} /> : floatingIcon}
          </FloatButton>
        )}
        <ChatBotContainer
          className="rsc-container"
          floating={floating}
          floatingStyle={floatingStyle}
          opened={opened}
          style={style}
          width={width}
          height={height}
        >
          {!hideHeader && header}
          <Content
            className="rsc-content"
            ref={this.setContentRef}
            floating={floating}
            style={contentStyle}
            height={height}
            hideInput={currentStep.hideInput}
          >
            { (renderedSteps.length > 0) && renderedSteps.map(this.renderStep)}
          </Content>
          <Footer className="rsc-footer" style={footerStyle}>
            {/*!currentStep.hideInput && */(
              <Input
                type="textarea"
                style={inputStyle}
                ref={this.setInputRef}
                className="rsc-input"
                placeholder={inputInvalid ? '' : inputPlaceholder}
                onKeyPress={this.handleKeyPress}
                onChange={this.onValueChange}
                value={inputValue}
                floating={floating}
                invalid={inputInvalid}
                disabled={disabled}
                hasButton={!hideSubmitButton}
                {...inputAttributesOverride}
              />
            )}
            {/*!currentStep.hideInput && !hideSubmitButton && */(
              <SubmitButton
                className="rsc-submit-button"
                style={submitButtonStyle}
                onClick={this.handleSubmitButton}
                invalid={inputInvalid}
                disabled={disabled}
                speaking={speaking}
              >
                {icon}
              </SubmitButton>
            )}
          </Footer>
        </ChatBotContainer>
      </div>
    );
  }
}

ChatBot.propTypes = {
  avatarStyle: PropTypes.objectOf(PropTypes.any),
  botAvatar: PropTypes.string,
  botDelay: PropTypes.number,
  bubbleOptionStyle: PropTypes.objectOf(PropTypes.any),
  bubbleStyle: PropTypes.objectOf(PropTypes.any),
  cache: PropTypes.bool,
  cacheName: PropTypes.string,
  className: PropTypes.string,
  contentStyle: PropTypes.objectOf(PropTypes.any),
  customDelay: PropTypes.number,
  customStyle: PropTypes.objectOf(PropTypes.any),
  enableMobileAutoFocus: PropTypes.bool,
  floating: PropTypes.bool,
  floatingIcon: PropTypes.oneOfType([PropTypes.string, PropTypes.element]),
  floatingStyle: PropTypes.objectOf(PropTypes.any),
  footerStyle: PropTypes.objectOf(PropTypes.any),
  handleEnd: PropTypes.func,
  headerComponent: PropTypes.element,
  headerTitle: PropTypes.string,
  height: PropTypes.string,
  hideBotAvatar: PropTypes.bool,
  hideHeader: PropTypes.bool,
  hideSubmitButton: PropTypes.bool,
  hideUserAvatar: PropTypes.bool,
  inputAttributes: PropTypes.objectOf(PropTypes.any),
  inputStyle: PropTypes.objectOf(PropTypes.any),
  opened: PropTypes.bool,
  toggleFloating: PropTypes.func,
  placeholder: PropTypes.string,
  recognitionEnable: PropTypes.bool,
  recognitionLang: PropTypes.string,
  recognitionPlaceholder: PropTypes.string,
  speechSynthesis: PropTypes.shape({
    enable: PropTypes.bool,
    lang: PropTypes.string,
    voice:
      typeof window !== 'undefined'
        ? PropTypes.instanceOf(window.SpeechSynthesisVoice)
        : PropTypes.any
  }),
  steps: PropTypes.arrayOf(PropTypes.object),
  style: PropTypes.objectOf(PropTypes.any),
  submitButtonStyle: PropTypes.objectOf(PropTypes.any),
  userAvatar: PropTypes.string,
  userDelay: PropTypes.number,
  width: PropTypes.string
};

ChatBot.defaultProps = {
  avatarStyle: {},
  botDelay: 0,
  bubbleOptionStyle: {},
  bubbleStyle: {},
  cache: false,
  cacheName: 'rsc_cache',
  className: '',
  contentStyle: {},
  customStyle: {},
  customDelay: 1000,
  enableMobileAutoFocus: false,
  floating: false,
  floatingIcon: <ChatIcon />,
  floatingStyle: {},
  footerStyle: {},
  handleEnd: undefined,
  headerComponent: undefined,
  headerTitle: 'Time Square',
  height: '520px',
  hideBotAvatar: false,
  hideHeader: false,
  hideSubmitButton: false,
  hideUserAvatar: false,
  inputStyle: {},
  opened: undefined,
  placeholder: 'Type the message ...',
  inputAttributes: {},
  recognitionEnable: false,
  recognitionLang: 'en',
  recognitionPlaceholder: 'Listening ...',
  speechSynthesis: {
    enable: false,
    lang: 'en',
    voice: null
  },
  style: {},
  submitButtonStyle: {},
  toggleFloating: undefined,
  userDelay: 1000,
  width: '850px',
  botAvatar:
    "data:image/svg+xml,%3csvg version='1' xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3e%3cpath d='M303 70a47 47 0 1 0-70 40v84h46v-84c14-8 24-23 24-40z' fill='%2393c7ef'/%3e%3cpath d='M256 23v171h23v-84a47 47 0 0 0-23-87z' fill='%235a8bb0'/%3e%3cpath fill='%2393c7ef' d='M0 240h248v124H0z'/%3e%3cpath fill='%235a8bb0' d='M264 240h248v124H264z'/%3e%3cpath fill='%2393c7ef' d='M186 365h140v124H186z'/%3e%3cpath fill='%235a8bb0' d='M256 365h70v124h-70z'/%3e%3cpath fill='%23cce9f9' d='M47 163h419v279H47z'/%3e%3cpath fill='%2393c7ef' d='M256 163h209v279H256z'/%3e%3cpath d='M194 272a31 31 0 0 1-62 0c0-18 14-32 31-32s31 14 31 32z' fill='%233c5d76'/%3e%3cpath d='M380 272a31 31 0 0 1-62 0c0-18 14-32 31-32s31 14 31 32z' fill='%231e2e3b'/%3e%3cpath d='M186 349a70 70 0 1 0 140 0H186z' fill='%233c5d76'/%3e%3cpath d='M256 349v70c39 0 70-31 70-70h-70z' fill='%231e2e3b'/%3e%3c/svg%3e",
  userAvatar:
    "data:image/svg+xml,%3csvg viewBox='-208.5 21 100 100' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3e%3ccircle cx='-158.5' cy='71' fill='%23F5EEE5' r='50'/%3e%3cdefs%3e%3ccircle cx='-158.5' cy='71' id='a' r='50'/%3e%3c/defs%3e%3cclipPath id='b'%3e%3cuse overflow='visible' xlink:href='%23a'/%3e%3c/clipPath%3e%3cpath clip-path='url(%23b)' d='M-108.5 121v-14s-21.2-4.9-28-6.7c-2.5-.7-7-3.3-7-12V82h-30v6.3c0 8.7-4.5 11.3-7 12-6.8 1.9-28.1 7.3-28.1 6.7v14h100.1z' fill='%23E6C19C'/%3e%3cg clip-path='url(%23b)'%3e%3cdefs%3e%3cpath d='M-108.5 121v-14s-21.2-4.9-28-6.7c-2.5-.7-7-3.3-7-12V82h-30v6.3c0 8.7-4.5 11.3-7 12-6.8 1.9-28.1 7.3-28.1 6.7v14h100.1z' id='c'/%3e%3c/defs%3e%3cclipPath id='d'%3e%3cuse overflow='visible' xlink:href='%23c'/%3e%3c/clipPath%3e%3cpath clip-path='url(%23d)' d='M-158.5 100.1c12.7 0 23-18.6 23-34.4 0-16.2-10.3-24.7-23-24.7s-23 8.5-23 24.7c0 15.8 10.3 34.4 23 34.4z' fill='%23D4B08C'/%3e%3c/g%3e%3cpath d='M-158.5 96c12.7 0 23-16.3 23-31 0-15.1-10.3-23-23-23s-23 7.9-23 23c0 14.7 10.3 31 23 31z' fill='%23F2CEA5'/%3e%3c/svg%3e"
};

function entityIntent(entity) {

  const useris$ = entity.getSignStatus()
    .startWith({ authenticated: false });

  return { useris$ }
}

function Intent(DOM) {
  const QAInput$ = xs.never()
  const clickevents$ = xs.never()
  return { clickevents$, QAInput$ }
}

function model(entityEvents) {
  const state$ = xs.merge(entityEvents.useris$)
    .fold((acc, x) => { return { ...acc, ...x } }, {})
    .startWith({ msglist: [], authenticated: false})
  return state$
}

const BotStyles = {
  divstyle: '#divChatbot.hue.page',
  div2style: '.mid.row.col.go'
  
};

function view(state$) {
  const vdom$ = state$
    .map( ([state, footerview, chatlistview]) => {
      // console.log("state=", state)
      return div(BotStyles.divstyle, [
          div(BotStyles.div2style, [
            h1('chatroom one Time Square')
          ]),
          div('.mid.row.col', [
              chatlistview,
            ]),
            footerview
      ])
    });
  return vdom$
}

function entityTodo(clickevents$, state$) {
  // sink map filtered stream of payloads into function and emit function
  const outgoingEntityEvents$ = xs.never()
  return outgoingEntityEvents$
}

export function ChatBot(sources) {
  const { DOM, entity } = sources;
  // console.log('sources.entity', entity)
  const chatlist = ChatList(sources)
  const footer = Footer(sources)

  const entityEvents = entityIntent(entity)
  // const events = Intent(DOM);

  const state1$ = model(entityEvents)

 // const outgoingEntityEvents$ = entityTodo(state$)

  const state$ = xs.combine(state1$, footer.DOM, chatlist.DOM);

  const vdom$ = view(state$)

  const sinks = {
    DOM: vdom$,
    value: state$,
    entity: xs.merge(footer.entity, chatlist.entity)
  }
  return sinks;

}

export default ChatBot;
