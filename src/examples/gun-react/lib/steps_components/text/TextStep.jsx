//Copied the GUI from https://codepen.io/JiaYuisalolicon/pen/xYjwyE

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Bubble from './Bubble';
import Image from './Image';
import StageName from './StageName';
import ImageContainer from './ImageContainer';
import Loading from '../common/Loading';
import TextStepContainer from './TextStepContainer';
import OptionsStep from '../options/OptionsStep';

const Photo = {
  width: '60px',
  height: '60px',
  backgroundSize: 'cover',
  borderRadius: '50%',
  margin: '10px'
};

const bold = {
  fontWeight: 'bold',
}

const flex = {
  display: 'flex'
}

const list = {
  listStyleType: 'none',
}

const ADbox = {
  height: '315px',
  width: '550px',
  borderRadius: '10px 10px 10px 10px',
  border: '1px solid #e5e5e5',
  marginTop: '10px'
}

const boximg = {
  width: '400px',
}

const icon = {
  height: '20px',
  paddingLeft: '10px'
}

const picbox = {
  backgroundSize: 'cover',
  backgroundPosition: 'center 35%',
  width: '550px',
  height: '200px',
  borderRadius: '10px 10px 0px 0px',
}

const wordbox = {
  padding: '15px',
  fontSize: '14px',
  lineHeight: '21px',
}

const gray = {
  color: '#aaa'
}

const iconword = {
  fontSize: '10px',
  paddingLeft: '10px',
  paddingRight: '50px',
  position: 'realative',
}

const red = {
  color: 'red',
  fontWeight: 'bold'
}

const iconbox = {
  marginTop: '15px'
}

const largebox = {
  fontSize: '14px',
  lineHeight: '21px',
  border: '1px solid #eee',
  borderRadius: '15px',
  backgroundColor: 'green',
  boxShadow: '3px 5px 10px #9b7c6c',
  width: '650px',
  margin: '20px auto',
  padding: '15px',
  justifyContent: 'left'
}

const blue = {
  color: '#7ABBE7'
}

const listspace = {
  marginLeft: '10px'
}

const hrwidth = {
  width: '650px',
  margin: '10px 0px 10px 0px',
  borderColor: '#fff'
}

let DATA = [
  {
    id: 1,
    author: 'Cookie',
    bio: 'Quam nunc et donec nec turpis a, semper.',
    photo: 'http://michaeldepippo.com/wp-content/uploads/2015/04/Monster_Bite_ChocolateChip_2.jpg',
    adpic: 'https://images-gmi-pmc.edge-generalmills.com/5504a4d4-ac62-4e63-b475-563ba492ccff.jpg'
  },
  // {
  //   id: 2,
  //   author: 'Cakeee',
  //   bio: 'Lectus phasellus, mi ut nam velit per et dictum.',
  //   photo: 'http://img.taste.com.au/Dtv0xl-v/w643-h428-cfill-q90/taste/2016/11/black-forest-cake-92535-1.jpeg',
  //   adpic: 'http://assets.kraftfoods.com/recipe_images/opendeploy/%20138280-49fdab4f7bf207b3cc31f72186c86b0a642f0802_642x428.jpg'
  // },
  // {
  //   id: 3,
  //   author: 'Fruit',
  //   bio: 'Ipsum commodo, et placerat neque cursus.',
  //   photo: 'https://therawherbalist.com/wp-content/uploads/2017/12/04-ZS-Banned-Fruit-80-ab.jpg',
  //   adpic: 'https://spindriftfresh.com/wp-content/uploads/2017/12/fruit-header-1.jpg'
  // },
  // {
  //   id: 4,
  //   author: 'Chocolate',
  //   bio: 'Ipsum commodo, et placerat neque cursus.',
  //   photo: 'http://dubeat.com/wp-content/uploads/chocolates2.jpg',
  //   adpic: 'https://aadl.org/sites/default/files/inline-images/chocolate_0.jpeg'
  // }
]

class IconBox extends React.Component {
  render() {
    return <div style={iconbox}>
            {/*icon*/}
           <img style={icon} src='http://iconshow.me/media/images/ui/ios7-icons/png/512/chatbubble-outline.png' />
            <span style={iconword}>2</span>

           <img style={icon} src='https://png.icons8.com/material/1600/retweet.png' />
              <span style={iconword}>47</span>

           <img style={icon} src='https://cdn0.iconfinder.com/data/icons/small-n-flat/24/678087-heart-512.png' />
              <span style={{...iconword, ...red}}>190</span>

          <img style={icon} src='http://icons.iconarchive.com/icons/custom-icon-design/mono-general-2/512/mail-icon.png' />
          </div>
  }
}

const AdBox = (props) => (
  <div style={ADbox}>
    <div style={{...picbox,backgroundImage: `url(${props.adpic})`,}}></div>
    <div style={wordbox}>
      <span style={bold}>What a GOOD choice!</span>
      <p>Can't pry yourself away from the tutorials? The cure is to make tiny little experiment apps. </p>
      <p style={gray}>Cookie.com</p>
    </div>
  </div>
)



const Message = (props) => (
  <div>
    <p>{props.bio}</p>
    <p>Message: <span style={blue}> {props.message} </span></p>
  </div>
)

const Author = (props) => (
  <span style={bold}>{props.author}</span>
)

const handleClick = () => {
  console.log("TextStep handleClick is clicked!!!")
  // this.setState({
  //   currentQuestion: true
  // })
}

const Card = props => {
    const { currentQuestion, user, id, avatarStyle, showAvatar, src, bot, step,  index,   previousStep, bubbleOptionStyle, speak, triggerNextStep } = props;
  // const bQuestion = props.message.endsWith('?') ? 'green' : 'yellow';
    // console.log("Bernard", "currentQuestion=" + currentQuestion + ". bot=" + bot);
    // if(step.options){
    //   console.log("card option totals=: ", Object.keys(step.options).length);
    //   Object.values(step.options).map(obj => {
    //     console.log("card option: ", obj);
    //   })
    // }

    return <div onClick={handleClick} 
                style={{...largebox, ...flex, margin: user ? '10px, 20px, 10px, 50px' : '10px, 50px, 10px, 20px', backgroundColor: currentQuestion ? 'yellow' : 'green'}} 
                key={id}>

      <div style={{...Photo, backgroundImage: `url(${props.photo})`}}>
      {bot && (<Image
              className="rsc-ts-image"
              user={user}
              src={src}
              alt="avatar"
            />)}

      </div>

      <div>
        <Author author={props.author}/>
        <Message bio={props.bio} message={props.message}/>
        {/* <AdBox adpic={props.adpic} /> */}
        {step.options && (<OptionsStep
          key={step.id}
          step={step}
          speak={speak}
          previousValue={previousStep.value}
          triggerNextStep={triggerNextStep}
          bubbleOptionStyle={bubbleOptionStyle}
        />)}
        <IconBox />
      </div>
  </div>
}

// const FormCard = (props) => (
//   <div>
//     {
//       Card(DATA[0])
//     }
//   </div>
// )

class TextStep extends Component {
  /* istanbul ignore next */
  state = {
    loading: true,
    currentQuestion: false
  };

  componentDidMount() {
    const { step, speak, previousValue, triggerNextStep, me } = this.props;
    const { component, delay, waitAction } = step;
    const isComponentWatingUser = component && waitAction;

    setTimeout(() => {
      this.setState({ loading: false }, () => {
        if (!isComponentWatingUser && !step.rendered) {
          triggerNextStep();
        }
        speak(step, previousValue);
      });
    }, delay);
  }

  getMessage = () => {
    const { previousValue, step } = this.props;
    const { message } = step;

    return message ? message.replace(/{previousValue}/g, previousValue) : '';
  };

  renderMessage = () => {
    const { step, previousStep, triggerNextStep } = this.props;
    const { component } = step;

    if (component) {
      return React.cloneElement(component, {
        step,
        previousStep,
        triggerNextStep
      });
    }

    return this.getMessage();
  };

  render() {
    const {
      step,
      isFirst,
      isLast,
      avatarStyle,
      bubbleStyle,
      hideBotAvatar,
      hideUserAvatar,
      me,
      bubbleOptionStyle,
      triggerNextStep
    } = this.props;
    const { loading, currentQuestion, key } = this.state;
    const { avatar, stageName, message, when, bot } = step;
    const { previousStep } = this.props;
    const isSameUser = previousStep && stageName == previousStep.stageName;
    const user = stageName == me;
    const showAvatar = user ? !hideUserAvatar : !hideBotAvatar;
    
    // console.log("TextStep", step);
    // console.log("TextStep", "step #=" + step._ + (step._ === undefined));

    return (
      <TextStepContainer className={`rsc-ts ${user ? 'rsc-ts-user' : 'rsc-ts-bot'}`} user={user}>
        {/* <FormCard data={DATA} /> */}
        {/* {Card(DATA[0])} */}

        { (step.id !== undefined) && Card({
          id: step.id,
          author: stageName,
          user,
          bio:  new Date(when).toLocaleString().toLowerCase(),
          message,
          photo: 'https://therawherbalist.com/wp-content/uploads/2017/12/04-ZS-Banned-Fruit-80-ab.jpg',
          adpic: 'https://spindriftfresh.com/wp-content/uploads/2017/12/fruit-header-1.jpg',
          currentQuestion,
          style: avatarStyle,
          showAvatar: showAvatar,
          src: avatar,
          alt:"avatar",
          bot,
          step,
          index: step.id,
          previousStep,
          bubbleOptionStyle,
          triggerNextStep
        })}
  
        {/* <ImageContainer className="rsc-ts-image-container" user={user}>
        {!isSameUser && (
          <StageName>
            {stageName}
          </StageName>
        )}
            {!isSameUser && (
          <Image
              className="rsc-ts-image"
              style={avatarStyle}
              showAvatar={showAvatar}
              user={user}
              src={avatar}
              alt="avatar"
            />
          )}
        </ImageContainer>
        <Bubble
          className="rsc-ts-bubble"
          style={bubbleStyle}
          user={user}
          showAvatar={showAvatar}
          isFirst={isFirst}
          isLast={isLast}
        >
          {loading ? <Loading /> : this.renderMessage()}
        </Bubble> */}


      </TextStepContainer>
    );
  }
}

TextStep.propTypes = {
  avatarStyle: PropTypes.objectOf(PropTypes.any).isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  bubbleStyle: PropTypes.objectOf(PropTypes.any).isRequired,
  hideBotAvatar: PropTypes.bool.isRequired,
  hideUserAvatar: PropTypes.bool.isRequired,
  previousStep: PropTypes.objectOf(PropTypes.any),
  previousValue: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.bool,
    PropTypes.number,
    PropTypes.object,
    PropTypes.array
  ]),
  speak: PropTypes.func,
  step: PropTypes.objectOf(PropTypes.any).isRequired,
  triggerNextStep: PropTypes.func.isRequired
};

TextStep.defaultProps = {
  previousStep: {},
  previousValue: '',
  speak: () => {},
};

export default TextStep;
