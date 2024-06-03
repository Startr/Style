#!/bin/bash -e
# Version 1.6.0

# Copyright (c) Startr LLC. All rights reserved.
# This script is licensed under the GNU Affero General Public License v3.0.
# For more information, see https://www.gnu.org/licenses/agpl-3.0.en.html

# Combined Build and Build 'n' Run Script

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Emojis
BUILD_EMOJI='🛠️'
RUN_EMOJI='🚀'
SUCCESS_EMOJI='✅'
ERROR_EMOJI='❌'

# Validate script arguments
if [ "$#" -lt 1 ]; then
    echo -e "${RED}Usage: $0 <build|run> [platform]${NC}"
    exit 1
fi

# RUN variable to decide whether to run the Docker container after building. 
# Set to 'run' if you want to run after building.
RUN=$1

# Validate RUN variable
if [ "$RUN" != "build" ] && [ "$RUN" != "run" ]; then
    echo -e "${RED}Invalid argument for RUN: $RUN. Use 'build' or 'run'.${NC}"
    exit 1
fi

# PLATFORM variable can be set via the second script argument. If not set, no platform will be specified in the docker build.
PLATFORM=$2

# Set PROJECTPATH to the path of the current directory
PROJECTPATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Set PROJECT to the lowercase version of the name of this directory
PROJECT=$(echo ${PROJECTPATH##*/} | awk '{print tolower($0)}')
# Set FULL_BRANCH to the name of the current Git branch
FULL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
# Set BRANCH to the lowercase version of this name, with everything after the last forward slash removed
BRANCH=${FULL_BRANCH##*/}
# Set TAG to the output of the git describe --always --tag command, which returns a "unique identifier" for the current commit
TAG=$(git describe --always --tag)

# Print the values of the variables
echo -e "${BLUE}PROJECTPATH=${NC}$PROJECTPATH"
echo -e "${BLUE}PROJECT=${NC}$PROJECT"
echo -e "${BLUE}FULL_BRANCH=${NC}$FULL_BRANCH"
echo -e "${BLUE}BRANCH=${NC}$BRANCH"

# Check if the RUN variable is set to 'run'
if [ "$RUN" == "run" ]; then
    echo -e "${YELLOW}${BUILD_EMOJI} Building Docker image...${NC}"
else
    echo -e "${YELLOW}${BUILD_EMOJI} Building Docker image without running...${NC}"
fi

# Check if PLATFORM is set and not empty
if [ -n "$PLATFORM" ]; then
    echo -e "${YELLOW}Building with specified platform: ${GREEN}$PLATFORM${NC}"
    PLATFORM_ARG="--platform $PLATFORM"
    BUILD_ARG="--build-arg PLATFORM=$PLATFORM"
    # Replace '/' with '-' in PLATFORM to create FLATPLATFORM
    FLATPLATFORM=$(echo "$PLATFORM" | tr '/' '-')
    # Use Dockerfile.$FLATPLATFORM
    DOCKERFILE="Dockerfile.$FLATPLATFORM"
    if [ ! -f "$DOCKERFILE" ]; then
        echo -e "${RED}Dockerfile for platform $FLATPLATFORM not found!${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Building without specifying platform.${NC}"
    PLATFORM_ARG=""
    BUILD_ARG=""
    # If PLATFORM is not set, build the default Dockerfile
    DOCKERFILE="Dockerfile"
    FLATPLATFORM="default"
fi

echo -e "${BLUE}docker build -t startr/$PROJECT-$BRANCH:$TAG .${NC}"
echo -e "${BLUE}docker tag startr/$PROJECT-$BRANCH:$TAG startr/$PROJECT-$BRANCH:latest${NC}"

# Build the Docker image
if docker build $PLATFORM_ARG $BUILD_ARG \
  -f $DOCKERFILE \
  -t startr/$PROJECT-$BRANCH:$TAG \
  -t startr/$PROJECT-$BRANCH:$FLATPLATFORM \
  -t startr/$PROJECT-$BRANCH:latest \
  .; then
    echo -e "${GREEN}${SUCCESS_EMOJI} Build successful!${NC}"
else
    echo -e "${RED}${ERROR_EMOJI} Build failed!${NC}"
    exit 1
fi

# Check if running in an interactive shell
if [ -t 1 ]; then
    DOCKER_RUN_FLAGS="-it"
else
    DOCKER_RUN_FLAGS=""
fi

# If the RUN variable is set to 'run', execute the docker run command
if [ "$RUN" == "run" ]; then
    echo -e "${YELLOW}${RUN_EMOJI} Running the Docker container...${NC}"
    if docker run $DOCKER_RUN_FLAGS \
      -p 9999:8888 \
      -p 9090:8080 \
      -p 6000:5000 \
      startr/$PROJECT-$BRANCH:latest; then
        echo -e "${GREEN}${SUCCESS_EMOJI} Docker container is running!${NC}"
    else
        echo -e "${RED}${ERROR_EMOJI} Failed to run Docker container!${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}${SUCCESS_EMOJI} Build completed. Not running the Docker container.${NC}"
fi