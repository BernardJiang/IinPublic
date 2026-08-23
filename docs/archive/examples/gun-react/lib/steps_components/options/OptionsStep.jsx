import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Option from './Option';
import OptionElement from './OptionElement';
import Options from './Options';
import OptionsStepContainer from './OptionsStepContainer';

class OptionsStep extends Component {
  onOptionClick = ({ value, label }) => {
    const { triggerNextStep } = this.props;
    console.log("No action yet to value", value)
    console.log("No action yet to label", label)
    triggerNextStep({ value });
    return true
  };

  renderOption = option => {
    // console.log("Enter into renderOption:", option)
    const { bubbleOptionStyle, step } = this.props;
    const { user } = step;
    const { value, label } = option;
    return (
      <Option key={value} className="rsc-os-option">
        <OptionElement
          className="rsc-os-option-element"
          style={bubbleOptionStyle}
          user={user}
          onClick={e => { e.stopPropagation(); this.onOptionClick({ value, label })}}
        >
          {label}
        </OptionElement>
      </Option>
    );
  };

  render() {
    const { step } = this.props;
    const { options } = step;
    // console.log("Step =", step)
    // console.log("Type of Options is array =", options instanceof Array )
    // console.log("Options =", options)
    // console.log("Option totals=: ", Object.keys(step.options).length);
    // Object.values(options).map(obj => {
    //   console.log("option: ", obj);
    // })

    return (
      <OptionsStepContainer className="rsc-os">
        <Options className="rsc-os-options">
          {Object.values(options).map(this.renderOption)}
        </Options>
      </OptionsStepContainer>
    );
  }
}

OptionsStep.propTypes = {
  bubbleOptionStyle: PropTypes.objectOf(PropTypes.any).isRequired,
  step: PropTypes.objectOf(PropTypes.any).isRequired,
  triggerNextStep: PropTypes.func.isRequired
};

export default OptionsStep;
